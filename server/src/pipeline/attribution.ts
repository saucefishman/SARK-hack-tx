// Stage 5 (DESIGN 6b/6c/6d): who paid how much, on what basis; plus repayments.
// Per relevant event (`attributeEvent`):
//   - user paid (Nessie txn): payer p_me, amount from the txn, `confirmed` (set by merge, kept here)
//   - friend paid, explicit + stated amount: `confirmed`
//   - friend paid, explicit, no amount: estimateBaseCost with a DB history dep -> `estimated` (null if unknowable)
//   - implicit (assumed payer): stays `assumed` (counts as "possible" only) and opens a `payer` review item;
//     an answered payer item replaces the assumed rows with the chosen payer, `confirmed`.
// Repayments (`attributeRepayments`): `repayments` prompt over thread messages + Nessie transfers -> ledger rows
// of kind `repayment` (event_id null); unexplained transfers -> `unaccounted`.
import { USER_ID } from "@sark/shared";
import type { Db } from "../db/pool";
import { stableId } from "../domain/ids";
import { dollarsToCents } from "../domain/money";
import { splitEvent } from "../domain/split";
import { estimateBaseCost, type BaseCostDeps } from "../domain/estimateBaseCost";
import { generateStructured, repayments, type GenerateOptions } from "../llm";
import { findNamedFriend } from "./ingest";

export const payerReviewId = (eventId: string) => stableId("rv_payer", eventId);

type Basis = "confirmed" | "assumed" | "estimated";

/** History deps backed by the DB: Me's past purchases (cents) at the same merchant before the event date. */
export function dbBaseCostDeps(db: Db): BaseCostDeps {
  return {
    history: async ({ merchant, before }) => {
      if (!merchant) return [];
      const { rows } = await db.query<{ amount_cents: number }>(
        `SELECT amount_cents FROM txn
         WHERE kind = 'purchase' AND payer_id = $1 AND lower(merchant) = lower($2) AND occurred_on < $3 ORDER BY occurred_on, id`,
        [USER_ID, merchant, before],
      );
      return rows.map((r) => r.amount_cents);
    },
  };
}

/** The known merchant (from the user's transactions) named in any of the texts; longest name wins. */
async function findMerchant(db: Db, texts: (string | null | undefined)[]): Promise<string | null> {
  const hay = texts.filter(Boolean).join(" \n ").toLowerCase();
  const { rows } = await db.query<{ merchant: string }>("SELECT DISTINCT merchant FROM txn WHERE merchant IS NOT NULL");
  return rows.map((r) => r.merchant).filter((m) => hay.includes(m.toLowerCase())).sort((a, b) => b.length - a.length || (a < b ? -1 : 1))[0] ?? null;
}

interface PayerRow {
  person_id: string;
  amount_cents: number | null;
  basis: Basis;
  evidence_message_id: string | null;
  txn_id: string | null;
}

export interface AttributionResult {
  eventId: string;
  payers: number;
  estimated: boolean;
  payerReview: boolean;
}

export async function attributeEvent(db: Db, id: string, deps: BaseCostDeps = dbBaseCostDeps(db)): Promise<AttributionResult | null> {
  const { rows: er } = await db.query<{
    id: string; d: string; description: string; attendee_ids: string[]; is_relevant: boolean; total_cents: number | null;
  }>("SELECT id, to_char(date,'YYYY-MM-DD') AS d, description, attendee_ids, is_relevant, total_cents FROM event WHERE id = $1", [id]);
  const ev = er[0];
  if (!ev) return null;
  const rid = payerReviewId(id);
  if (!ev.is_relevant) {
    await db.query("DELETE FROM review_item WHERE id = $1 AND status = 'open'", [rid]);
    return { eventId: id, payers: 0, estimated: false, payerReview: false };
  }

  const { rows: pr } = await db.query<PayerRow>(
    "SELECT person_id, amount_cents, basis, evidence_message_id, txn_id FROM event_payer WHERE event_id = $1 ORDER BY person_id",
    [id],
  );
  let payers = pr.map((p) => ({ ...p }));
  let estimated = false;

  // 1. explicit payer without an amount -> estimateBaseCost (stated -> history median -> cold start -> null)
  if (payers.length === 1 && payers[0].amount_cents === null) {
    const { rows: protos } = await db.query<{ description: string | null }>(
      "SELECT p.description FROM event_source es JOIN proto_event p ON p.id = es.proto_event_id WHERE es.event_id = $1",
      [id],
    );
    const merchant = await findMerchant(db, [ev.description, ...protos.map((p) => p.description)]);
    const res = await estimateBaseCost(
      { statedAmountCents: null, merchant, date: ev.d, headcount: new Set(ev.attendee_ids).size },
      deps,
    );
    if (res) {
      payers[0].amount_cents = res.amountCents;
      if (payers[0].basis !== "assumed") payers[0].basis = res.basis === "estimated" ? "estimated" : "confirmed";
      estimated = true;
    }
  }

  // 2. an answered payer review item replaces assumed guesses with the chosen payer
  const { rows: ri } = await db.query<{ status: string; answer: { payerId?: string } | null }>(
    "SELECT status, answer FROM review_item WHERE id = $1",
    [rid],
  );
  const item = ri[0];
  if (item?.status === "answered" && item.answer?.payerId && payers.length && payers.every((p) => p.basis === "assumed")) {
    const chosen = item.answer.payerId;
    const total = payers.reduce((s, p) => s + (p.amount_cents ?? 0), 0) || null;
    const prev = payers.find((p) => p.person_id === chosen);
    payers = [
      {
        person_id: chosen,
        amount_cents: total,
        basis: estimated ? "estimated" : "confirmed",
        evidence_message_id: prev?.evidence_message_id ?? null,
        txn_id: null,
      },
    ];
  } else if (item?.status === "dismissed" && payers.length && payers.every((p) => p.basis === "assumed")) {
    // The guess was rejected: nobody is assumed to have covered the user.
    payers = [];
  }

  const total = payers.length && payers.every((p) => p.amount_cents !== null) ? payers.reduce((s, p) => s + (p.amount_cents ?? 0), 0) : null;
  await db.tx(async (tx) => {
    await tx.query("DELETE FROM event_payer WHERE event_id = $1", [id]);
    for (const p of payers) {
      await tx.query(
        "INSERT INTO event_payer (event_id, person_id, amount_cents, basis, evidence_message_id, txn_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, p.person_id, p.amount_cents, p.basis, p.evidence_message_id, p.txn_id],
      );
    }
    // Nobody paid any more (assumed guess rejected): the event drops out of the ledger.
    await tx.query("UPDATE event SET total_cents = $2, is_relevant = is_relevant AND $3 WHERE id = $1", [id, total, payers.length > 0]);
  });

  // 3. assumed payer -> payer review item ("Did Sam cover you at ...?")
  const assumed = payers.filter((p) => p.basis === "assumed");
  if (assumed.length) {
    const { rows: names } = await db.query<{ id: string; display_name: string }>("SELECT id, display_name FROM person");
    const nm = new Map(names.map((n) => [n.id, n.display_name]));
    const friends = [...new Set([...assumed.map((p) => p.person_id), ...ev.attendee_ids])].filter((x) => x !== USER_ID);
    await db.query(
      `INSERT INTO review_item (id, kind, event_id, question, option_ids) VALUES ($1, 'payer', $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [rid, id, `Did ${nm.get(assumed[0].person_id) ?? assumed[0].person_id} cover you at ${ev.description} on ${ev.d}?`, friends],
    );
  } else {
    await db.query("DELETE FROM review_item WHERE id = $1 AND status = 'open'", [rid]);
  }
  return { eventId: id, payers: payers.length, estimated, payerReview: assumed.length > 0 };
}

// ---------------------------------------------------------------- repayments

export interface RepaymentCandidate {
  payerId: string;
  beneficiaryId: string | null;
  amountCents: number;
  via: "message" | "nessie";
  messageId: string | null;
  txnId: string | null;
  date: string;
}

/** Debts between the user and friends implied by relevant events (confirmed/estimated rows only), in cents. */
async function outstandingDebts(db: Db) {
  const { rows: evs } = await db.query<{ id: string; d: string; description: string; attendee_ids: string[] }>(
    "SELECT id, to_char(date,'YYYY-MM-DD') AS d, description, attendee_ids FROM event WHERE is_relevant ORDER BY date, id",
  );
  const { rows: pays } = await db.query<{ event_id: string; person_id: string; amount_cents: number | null; basis: Basis }>(
    "SELECT event_id, person_id, amount_cents, basis FROM event_payer ORDER BY event_id, person_id",
  );
  const out: { eventId: string; description: string; date: string; debtorId: string; creditorId: string; amountCents: number }[] = [];
  for (const e of evs) {
    const mine = pays.filter((p) => p.event_id === e.id && p.basis !== "assumed" && p.amount_cents !== null);
    if (!mine.length) continue;
    const { pairs } = splitEvent({
      attendeeIds: e.attendee_ids,
      payers: mine.map((p) => ({ personId: p.person_id, amountCents: p.amount_cents! })),
    });
    for (const p of pairs) {
      out.push({ eventId: e.id, description: e.description, date: e.d, debtorId: p.debtorId, creditorId: p.creditorId, amountCents: p.amountCents });
    }
  }
  return out;
}

/** Repayment candidates from message threads (LLM) and Nessie transfers (description names the friend). */
export async function detectRepayments(
  db: Db,
  opts: { llmMode?: GenerateOptions["mode"]; llm?: GenerateOptions } = {},
): Promise<{ candidates: RepaymentCandidate[]; unaccounted: RepaymentCandidate[]; llmCalls: number }> {
  const gen: GenerateOptions = { ...opts.llm, ...(opts.llmMode ? { mode: opts.llmMode } : {}) };
  const debts = await outstandingDebts(db);
  const candidates: RepaymentCandidate[] = [];
  const unaccounted: RepaymentCandidate[] = [];
  let llmCalls = 0;

  const { rows: persons } = await db.query<{ id: string; display_name: string; is_user: boolean }>("SELECT id, display_name, is_user FROM person ORDER BY id");
  const friendIds = new Set(persons.filter((p) => !p.is_user).map((p) => p.id));
  const nameOf = (id: string) => persons.find((p) => p.id === id)?.display_name ?? id;

  // ---- messages
  const { rows: msgs } = await db.query<{ id: string; thread_id: string; sender_id: string | null; d: string; t: string; body: string }>(
    `SELECT id, thread_id, sender_id, to_char(sent_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS d,
            to_char(sent_at AT TIME ZONE 'UTC','HH24:MI') AS t, body FROM message ORDER BY thread_id, sent_at, id`,
  );
  const threads = new Map<string, typeof msgs>();
  for (const m of msgs) (threads.get(m.thread_id) ?? threads.set(m.thread_id, []).get(m.thread_id)!).push(m);
  const msgIds = new Set(msgs.map((m) => m.id));
  const msgDate = new Map(msgs.map((m) => [m.id, m.d]));

  for (const [threadId, all] of threads) {
    const senders = new Set(all.map((m) => m.sender_id).filter((x): x is string => !!x));
    const relevantDebts = debts.filter((d) => {
      const friend = d.debtorId === USER_ID ? d.creditorId : d.debtorId;
      return senders.has(friend);
    });
    if (!relevantDebts.length) continue;
    const from = relevantDebts.map((d) => d.date).sort()[0];
    const input = {
      threadId,
      people: [...new Set([USER_ID, ...senders])].sort().map((id) => ({ id, name: nameOf(id) })),
      outstanding: relevantDebts.map((d) => ({
        eventId: d.eventId, description: d.description, date: d.date, debtorId: d.debtorId, creditorId: d.creditorId,
        amountDollars: d.amountCents / 100,
      })),
      messages: all.filter((m) => m.d >= from).map((m) => ({ id: m.id, senderId: m.sender_id ?? "unknown", time: m.t, date: m.d, text: m.body })),
    };
    const out = await generateStructured(db, repayments, input, gen);
    llmCalls++;
    for (const r of out.repayments) {
      if (!msgIds.has(r.messageId) || r.amountDollars === undefined || r.amountDollars <= 0) continue;
      const touchesUser = (r.fromId === USER_ID && friendIds.has(r.toId)) || (r.toId === USER_ID && friendIds.has(r.fromId));
      if (!touchesUser) continue; // friend-to-friend money is out of scope (DESIGN 6d)
      candidates.push({
        payerId: r.fromId, beneficiaryId: r.toId, amountCents: dollarsToCents(r.amountDollars), via: "message",
        messageId: r.messageId, txnId: null, date: msgDate.get(r.messageId)!,
      });
    }
  }

  // ---- Nessie transfers touching the user
  const { rows: transfers } = await db.query<{ id: string; payer_id: string; amount_cents: number; description: string | null; d: string }>(
    "SELECT id, payer_id, amount_cents, description, to_char(occurred_on,'YYYY-MM-DD') AS d FROM txn WHERE kind = 'transfer' ORDER BY occurred_on, id",
  );
  const transferCands: RepaymentCandidate[] = [];
  for (const t of transfers) {
    const other = t.payer_id === USER_ID ? (t.description ? await findNamedFriend(db, t.description) : null) : USER_ID;
    const c: RepaymentCandidate = { payerId: t.payer_id, beneficiaryId: other, amountCents: t.amount_cents, via: "nessie", messageId: null, txnId: t.id, date: t.d };
    (other ? transferCands : unaccounted).push(c);
  }

  // The same payment can show up as a message and as a transfer: keep the transfer (bank record).
  const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
  const dedupedMsgs = candidates.filter(
    (m) => !transferCands.some((t) => t.payerId === m.payerId && t.beneficiaryId === m.beneficiaryId && t.amountCents === m.amountCents && days(t.date, m.date) <= 3),
  );
  return { candidates: [...dedupedMsgs, ...transferCands], unaccounted, llmCalls };
}

export interface AttributionCounts {
  events: number;
  estimated: number;
  assumed: number;
  payerReviews: number;
  repayments: number;
  unaccounted: number;
  llmCalls: number;
}

/** Attribute every relevant event, then rebuild all repayment / transfer-level ledger rows. */
export async function runAttribution(
  db: Db,
  opts: { llmMode?: GenerateOptions["mode"]; llm?: GenerateOptions } = {},
): Promise<AttributionCounts> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM event ORDER BY date, id");
  const counts: AttributionCounts = { events: 0, estimated: 0, assumed: 0, payerReviews: 0, repayments: 0, unaccounted: 0, llmCalls: 0 };
  const deps = dbBaseCostDeps(db);
  for (const r of rows) {
    const res = await attributeEvent(db, r.id, deps);
    if (!res) continue;
    counts.events++;
    if (res.estimated) counts.estimated++;
    if (res.payerReview) counts.payerReviews++;
  }
  const { rows: a } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM event_payer ep JOIN event e ON e.id = ep.event_id WHERE e.is_relevant AND ep.basis = 'assumed'`,
  );
  counts.assumed = Number(a[0].n);

  const det = await detectRepayments(db, opts);
  counts.llmCalls = det.llmCalls;
  await db.tx(async (tx) => {
    await tx.query("DELETE FROM ledger_entry WHERE event_id IS NULL AND kind IN ('repayment','unaccounted')");
    for (const c of det.candidates) {
      await tx.query(
        `INSERT INTO ledger_entry (id, event_id, payer_id, beneficiary_id, amount_cents, kind, basis, confidence, evidence_message_id, txn_id)
         VALUES ($1, NULL, $2, $3, $4, 'repayment', 'confirmed', $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [
          stableId("le", "repayment", c.messageId ?? c.txnId ?? "", c.payerId, c.beneficiaryId ?? "", c.amountCents),
          c.payerId, c.beneficiaryId, c.amountCents, c.via === "nessie" ? 1 : 0.85, c.messageId, c.txnId,
        ],
      );
      counts.repayments++;
    }
    for (const c of det.unaccounted) {
      await tx.query(
        `INSERT INTO ledger_entry (id, event_id, payer_id, beneficiary_id, amount_cents, kind, basis, confidence, evidence_message_id, txn_id)
         VALUES ($1, NULL, $2, NULL, $3, 'unaccounted', 'confirmed', 1, NULL, $4) ON CONFLICT (id) DO NOTHING`,
        [stableId("le", "unaccounted", c.txnId ?? "", c.payerId, c.amountCents), c.payerId, c.amountCents, c.txnId],
      );
      counts.unaccounted++;
    }
  });
  return counts;
}
