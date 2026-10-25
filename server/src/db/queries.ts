// Typed read queries: snake_case rows → shared camelCase types. Dates as 'YYYY-MM-DD', timestamps as ISO.
import {
  USER_ID,
  type Evidence,
  type FriendDetailResponse,
  type FriendEntry,
  type FriendSummary,
  type LedgerEntry,
  type Person,
  type PersonRef,
  type ReviewItemDto,
} from "@sark/shared";
import { friendTotals } from "../domain/balance";
import type { Db } from "./pool";

const SNIPPET_LEN = 140;
const MAX_CONTEXT_EVIDENCE = 3;

const snippet = (body: string) => (body.length > SNIPPET_LEN ? body.slice(0, SNIPPET_LEN - 1) + "…" : body);
const iso = (t: unknown) => (t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString());
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function listPersons(db: Db): Promise<Person[]> {
  const { rows } = await db.query<{ id: string; display_name: string; is_user: boolean; platform_user_id: string | null }>(
    "SELECT id, display_name, is_user, platform_user_id FROM person ORDER BY display_name, id",
  );
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    isUser: r.is_user,
    platformUserId: r.platform_user_id,
  }));
}

interface LedgerRow {
  id: string;
  event_id: string | null;
  payer_id: string;
  beneficiary_id: string | null;
  amount_cents: number;
  kind: LedgerEntry["kind"];
  basis: LedgerEntry["basis"];
  confidence: number;
  evidence_message_id: string | null;
  txn_id: string | null;
}

const toEntry = (r: LedgerRow): LedgerEntry => ({
  id: r.id,
  eventId: r.event_id,
  payerId: r.payer_id,
  beneficiaryId: r.beneficiary_id,
  amountCents: r.amount_cents,
  kind: r.kind,
  basis: r.basis,
  confidence: r.confidence,
  evidenceMessageId: r.evidence_message_id,
  txnId: r.txn_id,
});

/** All ledger entries, optionally only those where the person is payer or beneficiary. */
export async function listLedgerEntries(db: Db, opts: { personId?: string } = {}): Promise<LedgerEntry[]> {
  const where = opts.personId ? "WHERE payer_id = $1 OR beneficiary_id = $1" : "";
  const { rows } = await db.query<LedgerRow>(
    `SELECT id, event_id, payer_id, beneficiary_id, amount_cents, kind, basis, confidence, evidence_message_id, txn_id
     FROM ledger_entry ${where} ORDER BY id`,
    opts.personId ? [opts.personId] : [],
  );
  return rows.map(toEntry);
}

function summarize(p: { id: string; display_name: string }, entries: LedgerEntry[]): FriendSummary {
  const t = friendTotals(p.id, entries);
  return { personId: p.id, name: p.display_name, ...t };
}

const byGivenThenName = (a: FriendSummary, b: FriendSummary) =>
  b.spentOnYouCents - a.spentOnYouCents || a.name.localeCompare(b.name);

/** Friend rows (non-user persons), sorted by spentOnYouCents desc, ties by name. Optionally limited to ids. */
export async function getFriendSummaries(db: Db, onlyIds?: string[]): Promise<FriendSummary[]> {
  const { rows: friends } = await db.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM person WHERE is_user = false",
  );
  const entries = await listLedgerEntries(db);
  const { rows: sugg } = await db.query<{ friend_id: string; n: string }>("SELECT friend_id, count(*) AS n FROM payback_suggestion GROUP BY friend_id");
  const paybackCount = new Map(sugg.map((s) => [s.friend_id, Number(s.n)]));
  return friends
    .filter((f) => !onlyIds || onlyIds.includes(f.id))
    .map((f) => {
      const row = summarize(f, entries);
      const n = paybackCount.get(f.id) ?? 0;
      return row.balanceCents < 0 && n > 0 ? { ...row, paybackCount: n } : row; // suggestions only exist while the user owes
    })
    .sort(byGivenThenName);
}

/** Friend summary + entries with event, names and evidence. Null if unknown or the user. */
export async function getFriendDetail(db: Db, personId: string): Promise<FriendDetailResponse | null> {
  const { rows: pr } = await db.query<{ id: string; display_name: string; is_user: boolean }>(
    "SELECT id, display_name, is_user FROM person WHERE id = $1",
    [personId],
  );
  const person = pr[0];
  if (!person || person.is_user) return null;

  const all = await listLedgerEntries(db);
  const friend = summarize(person, all);
  const mine = all.filter(
    (e) =>
      (e.payerId === personId && e.beneficiaryId === USER_ID) || (e.payerId === USER_ID && e.beneficiaryId === personId),
  );

  const { rows: people } = await db.query<{ id: string; display_name: string }>("SELECT id, display_name FROM person");
  const names = new Map(people.map((p) => [p.id, p.display_name]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? id) : "Unknown");

  const eventIds = [...new Set(mine.map((e) => e.eventId).filter((x): x is string => !!x))];
  const events = new Map<
    string,
    { id: string; date: string; description: string; attendee_ids: string[]; context_message_ids: string[] }
  >();
  if (eventIds.length) {
    const { rows } = await db.query<{
      id: string;
      date: string;
      description: string;
      attendee_ids: string[];
      context_message_ids: string[];
    }>(
      `SELECT id, to_char(date,'YYYY-MM-DD') AS date, description, attendee_ids, context_message_ids
       FROM event WHERE id = ANY($1)`,
      [eventIds],
    );
    for (const r of rows) events.set(r.id, r);
  }

  // Fetch every message we might cite in one query.
  const msgIds = new Set<string>();
  for (const e of mine) {
    if (e.evidenceMessageId) msgIds.add(e.evidenceMessageId);
    if (e.eventId) events.get(e.eventId)?.context_message_ids.slice(0, MAX_CONTEXT_EVIDENCE).forEach((m) => msgIds.add(m));
  }
  const msgs = new Map<string, Evidence>();
  if (msgIds.size) {
    const { rows } = await db.query<{ id: string; body: string; sent_at: Date | string }>(
      "SELECT id, body, sent_at FROM message WHERE id = ANY($1)",
      [[...msgIds]],
    );
    for (const m of rows) msgs.set(m.id, { messageId: m.id, snippet: snippet(m.body), sentAt: iso(m.sent_at) });
  }

  const entries: FriendEntry[] = mine.map((e) => {
    const ev = e.eventId ? events.get(e.eventId) : undefined;
    const ids = [e.evidenceMessageId, ...(ev?.context_message_ids ?? []).slice(0, MAX_CONTEXT_EVIDENCE)];
    const evidence = [...new Set(ids.filter((x): x is string => !!x))]
      .map((id) => msgs.get(id))
      .filter((x): x is Evidence => !!x);
    return {
      id: e.id,
      event: ev
        ? {
            id: ev.id,
            date: ev.date,
            description: ev.description,
            attendees: ev.attendee_ids.map((id): PersonRef => ({ personId: id, name: nameOf(id) })),
          }
        : null,
      payerName: nameOf(e.payerId),
      beneficiaryName: nameOf(e.beneficiaryId),
      amountCents: e.amountCents,
      kind: e.kind,
      basis: e.basis,
      confidence: e.confidence,
      evidence,
    };
  });
  // Newest event first; entries without an event last.
  entries.sort((a, b) => (b.event?.date ?? "").localeCompare(a.event?.date ?? "") || a.id.localeCompare(b.id));
  return { friend, entries };
}

/** Open review items as DTOs. */
export async function listOpenReviewItems(db: Db): Promise<ReviewItemDto[]> {
  const { rows } = await db.query<{
    id: string;
    kind: ReviewItemDto["kind"];
    question: string;
    option_ids: string[];
    ev_date: string | null;
    ev_desc: string | null;
    t_merchant: string | null;
    t_desc: string | null;
    t_amount: number | null;
    t_date: string | null;
  }>(
    `SELECT r.id, r.kind, r.question, r.option_ids,
            to_char(e.date,'YYYY-MM-DD') AS ev_date, e.description AS ev_desc,
            t.merchant AS t_merchant, t.description AS t_desc, t.amount_cents AS t_amount,
            to_char(t.occurred_on,'YYYY-MM-DD') AS t_date
     FROM review_item r
     LEFT JOIN event e ON e.id = r.event_id
     LEFT JOIN txn t ON t.id = r.txn_id
     WHERE r.status = 'open'
     ORDER BY r.created_at, r.id`,
  );
  const { rows: people } = await db.query<{ id: string; display_name: string }>("SELECT id, display_name FROM person");
  const names = new Map(people.map((p) => [p.id, p.display_name]));
  return rows.map((r) => {
    let eventSummary = "";
    if (r.ev_date) eventSummary = `${r.ev_date} · ${r.ev_desc ?? ""}`.trim();
    else if (r.t_date)
      eventSummary = `${r.t_date} · ${r.t_merchant ?? r.t_desc ?? "Transaction"} ${dollars(r.t_amount ?? 0)}`;
    const dto: ReviewItemDto = { id: r.id, kind: r.kind, question: r.question, eventSummary };
    if (r.option_ids.length)
      dto.options = r.option_ids.map((id) => ({ personId: id, name: names.get(id) ?? id }));
    return dto;
  });
}
