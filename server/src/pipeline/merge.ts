// Stage 3 (DESIGN 6 step 3): per day, `mergeDay` groups proto events -> event, event_source, event_payer.
// MVP simplification (BUILDPLAN Phase 4): the user's Nessie purchase is authoritative for "Me paid" (payer p_me,
// amount from the DB, never the LLM); friend payers come from the group's LLM payers, with amounts taken from the
// LLM (dollars -> cents) or the message proto that states them. Per-person prices are multiplied by headcount in code.
// Idempotent: events are upserted by deterministic id, their payer/source rows rebuilt, stale events deleted.
import { USER_ID } from "@sark/shared";
import type { Db } from "../db/pool";
import { eventId } from "../domain/ids";
import { dollarsToCents } from "../domain/money";
import { generateStructured, mergeDay, type GenerateOptions } from "../llm";

export interface MergeCounts {
  days: number;
  events: number;
  payers: number;
  llmCalls: number;
  staleRemoved: number;
}

interface Proto {
  id: string;
  source: "calendar" | "message" | "txn";
  d: string;
  time: string | null;
  description: string | null;
  people_ids: string[];
  details: Record<string, any>;
}

interface PayerDraft {
  personId: string;
  amountCents: number | null;
  basis: "confirmed" | "assumed" | "estimated";
  evidenceMessageId: string | null;
  txnId: string | null;
}

/** Best message supporting `payerId` having paid: a covered phrase by the payer, any covered phrase, the payer's message with a price. */
export function findEvidenceMessage(
  msgs: { id: string; sender_id: string | null; body: string }[],
  payerId: string,
  phrases: string[],
): string | null {
  const has = (body: string, p: string) => body.toLowerCase().includes(p.toLowerCase());
  const byPhrase = msgs.filter((m) => phrases.some((p) => p && has(m.body, p)));
  return (
    byPhrase.find((m) => m.sender_id === payerId)?.id ??
    byPhrase[0]?.id ??
    msgs.find((m) => m.sender_id === payerId && m.body.includes("$"))?.id ??
    null
  );
}

export async function mergeEvents(
  db: Db,
  opts: { llmMode?: GenerateOptions["mode"]; llm?: GenerateOptions } = {},
): Promise<MergeCounts> {
  const gen: GenerateOptions = { ...opts.llm, ...(opts.llmMode ? { mode: opts.llmMode } : {}) };
  const counts: MergeCounts = { days: 0, events: 0, payers: 0, llmCalls: 0, staleRemoved: 0 };

  const { rows: persons } = await db.query<{ id: string; display_name: string }>("SELECT id, display_name FROM person ORDER BY id");
  const known = new Set(persons.map((p) => p.id));
  const { rows: protos } = await db.query<Proto>(
    `SELECT id, source, to_char(date,'YYYY-MM-DD') AS d, time, description, people_ids, details
     FROM proto_event ORDER BY date, id`,
  );
  const { rows: txnRows } = await db.query<{ id: string; amount_cents: number; payer_id: string }>(
    "SELECT id, amount_cents, payer_id FROM txn WHERE kind = 'purchase'",
  );
  const txns = new Map(txnRows.map((t) => [t.id, t]));

  const byDay = new Map<string, Proto[]>();
  for (const p of protos) (byDay.get(p.d) ?? byDay.set(p.d, []).get(p.d)!).push(p);

  const kept: string[] = [];
  for (const date of [...byDay.keys()].sort()) {
    const dayProtos = byDay.get(date)!;
    counts.days++;
    const out = await generateStructured(
      db,
      mergeDay,
      {
        date,
        people: persons.map((p) => ({ id: p.id, name: p.display_name })),
        protoEvents: dayProtos.map((p) => ({
          id: p.id,
          source: p.source,
          ...(p.time ? { time: p.time } : {}),
          ...(p.description ? { description: p.description } : {}),
          peopleIds: p.people_ids,
          details: p.details,
        })),
      },
      gen,
    );
    counts.llmCalls++;
    const protoById = new Map(dayProtos.map((p) => [p.id, p]));

    for (const g of out.groups) {
      const members = g.protoEventIds.map((id) => protoById.get(id)!);
      const txnProtos = members.filter((m) => m.source === "txn");
      const msgProtos = members.filter((m) => m.source === "message");
      const txnList = txnProtos.map((m) => txns.get(String(m.details.txnId))).filter((t): t is NonNullable<typeof t> => !!t);

      const attendees = [...new Set(g.attendeeIds.filter((id) => known.has(id)))];
      for (const t of txnList) if (!attendees.includes(t.payer_id)) attendees.push(t.payer_id);
      attendees.sort();

      const contextMessageIds = [...new Set(msgProtos.flatMap((m) => (m.details.sourceMessageIds as string[] | undefined) ?? []))];
      const { rows: msgs } = contextMessageIds.length
        ? await db.query<{ id: string; sender_id: string | null; body: string }>(
            "SELECT id, sender_id, body FROM message WHERE id = ANY($1) ORDER BY sent_at, id",
            [contextMessageIds],
          )
        : { rows: [] };
      const phrases = msgProtos.flatMap((m) => (m.details.coveredPhrases as string[] | undefined) ?? []);
      const orderedContext = msgs.map((m) => m.id);

      // ---- payers
      const payers: PayerDraft[] = [];
      const meTxns = txnList.filter((t) => t.payer_id === USER_ID);
      if (meTxns.length) {
        payers.push({
          personId: USER_ID,
          amountCents: meTxns.reduce((s, t) => s + t.amount_cents, 0),
          basis: "confirmed",
          evidenceMessageId: findEvidenceMessage(msgs, USER_ID, phrases),
          txnId: [...meTxns].sort((a, b) => (a.id < b.id ? -1 : 1))[0].id,
        });
      }
      const statedTotal = (): number | null => {
        if (g.totalDollars !== undefined) return dollarsToCents(g.totalDollars);
        const stated = msgProtos.map((m) => m.details.amountDollars).find((x) => typeof x === "number");
        if (typeof stated === "number") return dollarsToCents(stated);
        const per = msgProtos.map((m) => m.details.perPersonAmountDollars).find((x) => typeof x === "number");
        if (typeof per === "number") return dollarsToCents(per) * attendees.length;
        return null;
      };
      const friendPayers = g.payers.filter((p) => known.has(p.personId) && !(meTxns.length && p.personId === USER_ID));
      for (const p of [...new Map(friendPayers.map((x) => [x.personId, x])).values()]) {
        let amountCents: number | null = null;
        if (p.amountDollars !== undefined) amountCents = dollarsToCents(p.amountDollars);
        else {
          const fromMsg = msgProtos
            .flatMap((m) => (m.details.payers as { personId: string; amountDollars?: number }[] | undefined) ?? [])
            .find((x) => x.personId === p.personId && x.amountDollars !== undefined);
          if (fromMsg) amountCents = dollarsToCents(fromMsg.amountDollars!);
          else if (friendPayers.length === 1) amountCents = statedTotal();
        }
        if (meTxns.length && amountCents === null) continue; // a friend's unknown part of a bill the user paid: ignore
        const basis = amountCents === null ? (p.basis === "assumed" ? "assumed" : "estimated") : p.basis === "assumed" ? "assumed" : "confirmed";
        payers.push({
          personId: p.personId,
          amountCents,
          basis,
          evidenceMessageId: findEvidenceMessage(msgs, p.personId, phrases),
          txnId: null,
        });
      }

      // Implicit trigger (6c): user attended, nobody is known to have paid -> assume the friend who most often paid before.
      if (!payers.length && attendees.length >= 2 && attendees.includes(USER_ID)) {
        const friends = attendees.filter((id) => id !== USER_ID);
        const { rows } = await db.query<{ person_id: string }>(
          `SELECT ep.person_id FROM event_payer ep JOIN event e ON e.id = ep.event_id
           WHERE e.date < $1 AND ep.basis IN ('confirmed','estimated') AND ep.person_id = ANY($2)
           GROUP BY ep.person_id ORDER BY count(*) DESC, ep.person_id LIMIT 1`,
          [date, friends],
        );
        if (rows[0]) {
          payers.push({ personId: rows[0].person_id, amountCents: statedTotal(), basis: "assumed", evidenceMessageId: null, txnId: null });
        }
      }

      // ---- event row
      const anchor = txnList[0]?.id ?? contextMessageIds[0] ?? members[0].id;
      const id = eventId({ date, attendeeIds: attendees, anchor });
      const sources = new Set(members.map((m) => m.source));
      const known$ = payers.every((p) => p.amountCents !== null);
      const total = payers.length && known$ ? payers.reduce((s, p) => s + (p.amountCents ?? 0), 0) : null;
      const time = g.time ?? members.find((m) => m.time)?.time ?? null;
      await db.tx(async (tx) => {
        await tx.query(
          `INSERT INTO event (id, date, time, description, attendee_ids, total_cents, source_count, is_relevant, confidence, context_message_ids, anchor_txn_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, time = EXCLUDED.time, description = EXCLUDED.description,
             attendee_ids = EXCLUDED.attendee_ids, total_cents = EXCLUDED.total_cents, source_count = EXCLUDED.source_count,
             is_relevant = false, confidence = EXCLUDED.confidence, context_message_ids = EXCLUDED.context_message_ids,
             anchor_txn_id = EXCLUDED.anchor_txn_id`,
          [id, date, time, g.description, attendees, total, sources.size, g.confidence, orderedContext, txnList[0]?.id ?? null],
        );
        await tx.query("DELETE FROM event_source WHERE event_id = $1", [id]);
        await tx.query("DELETE FROM event_payer WHERE event_id = $1", [id]);
        for (const m of members) await tx.query("INSERT INTO event_source (event_id, proto_event_id) VALUES ($1, $2)", [id, m.id]);
        for (const p of payers) {
          await tx.query(
            `INSERT INTO event_payer (event_id, person_id, amount_cents, basis, evidence_message_id, txn_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, p.personId, p.amountCents, p.basis, p.evidenceMessageId, p.txnId],
          );
        }
      });
      kept.push(id);
      counts.events++;
      counts.payers += payers.length;
    }
  }

  // Stale events (ids no longer produced): keep their review items (event link cleared), drop the rest via cascade.
  const { rows: stale } = await db.query<{ id: string }>("SELECT id FROM event WHERE NOT (id = ANY($1))", [kept]);
  if (stale.length) {
    const ids = stale.map((s) => s.id);
    await db.query("UPDATE review_item SET event_id = NULL WHERE event_id = ANY($1)", [ids]);
    await db.query("DELETE FROM event WHERE id = ANY($1)", [ids]);
    await db.query("DELETE FROM review_item WHERE event_id IS NULL AND kind IN ('attendees','payer') AND status = 'open' AND txn_id IS NULL");
  }
  counts.staleRemoved = stale.length;
  return counts;
}
