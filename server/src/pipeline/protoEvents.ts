// Stage 2 (DESIGN 6 step 2): per-source proto_event rows.
//  - messages: one thread x one UTC day -> `messageDay` prompt -> one proto per extracted outing
//  - calendar: one proto per calendar_event (direct mapping)
//  - txns: one proto per purchase, `txnSocial` prompt -> details.looks_social (transfers are repayments, not events)
// Idempotent: deterministic ids (stableId), upsert, stale rows removed.
import { USER_ID } from "@sark/shared";
import type { Db } from "../db/pool";
import { stableId } from "../domain/ids";
import { generateStructured, messageDay, txnSocial, type GenerateOptions } from "../llm";

export interface ProtoCounts {
  message: number;
  calendar: number;
  txn: number;
  llmCalls: number;
}

interface ProtoRow {
  id: string;
  source: "calendar" | "message" | "txn";
  sourceRef: string;
  date: string;
  time: string | null;
  description: string | null;
  peopleIds: string[];
  details: Record<string, unknown>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function buildProtoEvents(
  db: Db,
  opts: { llmMode?: GenerateOptions["mode"]; llm?: GenerateOptions } = {},
): Promise<ProtoCounts> {
  const gen: GenerateOptions = { ...opts.llm, ...(opts.llmMode ? { mode: opts.llmMode } : {}) };
  const counts: ProtoCounts = { message: 0, calendar: 0, txn: 0, llmCalls: 0 };
  const protos: ProtoRow[] = [];

  const { rows: persons } = await db.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM person ORDER BY id",
  );
  const known = new Set(persons.map((p) => p.id));
  const nameOf = new Map(persons.map((p) => [p.id, p.display_name]));
  const { rows: aliasRows } = await db.query<{ person_id: string; value: string }>(
    `SELECT person_id, value FROM person_alias
     WHERE person_id IS NOT NULL AND status = 'confirmed' AND kind IN ('display_name','nickname','handle') ORDER BY person_id, value`,
  );
  const aliases = new Map<string, string[]>();
  for (const a of aliasRows) {
    if (a.value === (nameOf.get(a.person_id) ?? "").toLowerCase()) continue;
    (aliases.get(a.person_id) ?? aliases.set(a.person_id, []).get(a.person_id)!).push(a.value);
  }
  const personRef = (id: string) => ({ id, name: nameOf.get(id) ?? id, ...(aliases.has(id) ? { aliases: aliases.get(id) } : {}) });

  // ---- messages: thread x day
  const { rows: msgs } = await db.query<{
    id: string; thread_id: string; sender_id: string | null; sender_name: string; d: string; t: string; body: string;
  }>(
    `SELECT id, thread_id, sender_id, sender_name,
            to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, to_char(sent_at AT TIME ZONE 'UTC', 'HH24:MI') AS t, body
     FROM message ORDER BY thread_id, sent_at, id`,
  );
  const threads = new Map<string, typeof msgs>();
  for (const m of msgs) (threads.get(m.thread_id) ?? threads.set(m.thread_id, []).get(m.thread_id)!).push(m);
  for (const [threadId, all] of threads) {
    const senderIds = [...new Set([USER_ID, ...all.map((m) => m.sender_id).filter((x): x is string => !!x)])].sort();
    const title = `Chat with ${senderIds.filter((id) => id !== USER_ID).map((id) => nameOf.get(id) ?? id).join(", ") || "yourself"}`;
    const days = [...new Set(all.map((m) => m.d))];
    for (const date of days) {
      const input = {
        threadId,
        threadTitle: title,
        date,
        people: senderIds.map(personRef),
        messages: all
          .filter((m) => m.d === date)
          .map((m) => ({ id: m.id, senderId: m.sender_id ?? "unknown", senderName: m.sender_name, time: m.t, text: m.body })),
      };
      const out = await generateStructured(db, messageDay, input, gen);
      counts.llmCalls++;
      const msgIds = new Set(input.messages.map((m) => m.id));
      out.events.forEach((ev, i) => {
        const peopleIds = [...new Set(ev.peopleIds.filter((id) => known.has(id)))];
        const payers = (ev.payers ?? []).filter((p) => known.has(p.personId));
        protos.push({
          id: stableId("pe", "message", threadId, date, i),
          source: "message",
          sourceRef: `${threadId}:${date}#${i}`,
          date: ISO_DATE.test(ev.date) ? ev.date : date,
          time: ev.time ?? null,
          description: ev.description,
          peopleIds,
          details: {
            threadId,
            ...(ev.payerId && known.has(ev.payerId) ? { payerId: ev.payerId } : {}),
            ...(ev.amountDollars !== undefined ? { amountDollars: ev.amountDollars } : {}),
            ...(ev.perPersonAmountDollars !== undefined ? { perPersonAmountDollars: ev.perPersonAmountDollars } : {}),
            ...(payers.length ? { payers } : {}),
            coveredPhrases: ev.coveredPhrases,
            paymentMentions: ev.paymentMentions,
            sourceMessageIds: ev.sourceMessageIds.filter((id) => msgIds.has(id)),
          },
        });
        counts.message++;
      });
    }
  }

  // ---- calendar
  const { rows: cals } = await db.query<{
    id: string; title: string; description: string | null; d: string; t: string; attendee_ids: string[];
  }>(
    `SELECT id, title, description, to_char(start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
            to_char(start_at AT TIME ZONE 'UTC', 'HH24:MI') AS t, attendee_ids
     FROM calendar_event ORDER BY start_at, id`,
  );
  for (const c of cals) {
    protos.push({
      id: stableId("pe", "calendar", c.id),
      source: "calendar",
      sourceRef: c.id,
      date: c.d,
      time: c.t,
      description: c.title,
      peopleIds: c.attendee_ids,
      details: { calendarEventId: c.id, title: c.title, ...(c.description ? { description: c.description } : {}) },
    });
    counts.calendar++;
  }

  // ---- transactions (purchases only)
  const { rows: txns } = await db.query<{
    id: string; amount_cents: number; merchant: string | null; merchant_category: string | null; description: string | null;
    d: string; payer_id: string;
  }>(
    `SELECT id, amount_cents, merchant, merchant_category, description, to_char(occurred_on, 'YYYY-MM-DD') AS d, payer_id
     FROM txn WHERE kind = 'purchase' ORDER BY occurred_on, id`,
  );
  for (const t of txns) {
    const merchant = t.merchant ?? t.description ?? "Unknown merchant";
    const out = await generateStructured(
      db,
      txnSocial,
      {
        txnId: t.id,
        merchant,
        category: t.merchant_category ?? "unknown",
        amountDollars: t.amount_cents / 100,
        date: t.d,
        siblings: txns
          .filter((s) => s.d === t.d && s.id !== t.id)
          .map((s) => ({ merchant: s.merchant ?? s.description ?? "Unknown merchant", amountDollars: s.amount_cents / 100 })),
      },
      gen,
    );
    counts.llmCalls++;
    protos.push({
      id: stableId("pe", "txn", t.id),
      source: "txn",
      sourceRef: t.id,
      date: t.d,
      time: null,
      description: `${merchant} purchase`,
      peopleIds: [t.payer_id],
      details: {
        txnId: t.id,
        merchant,
        category: t.merchant_category,
        amountDollars: t.amount_cents / 100,
        payerId: t.payer_id,
        looks_social: out.looksSocial,
        reason: out.reason,
      },
    });
    counts.txn++;
  }

  await db.tx(async (tx) => {
    for (const p of protos) {
      await tx.query(
        `INSERT INTO proto_event (id, source, source_ref, date, time, description, people_ids, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, source_ref = EXCLUDED.source_ref, date = EXCLUDED.date,
           time = EXCLUDED.time, description = EXCLUDED.description, people_ids = EXCLUDED.people_ids, details = EXCLUDED.details`,
        [p.id, p.source, p.sourceRef, p.date, p.time, p.description, p.peopleIds, JSON.stringify(p.details)],
      );
    }
    await tx.query("DELETE FROM proto_event WHERE NOT (id = ANY($1))", [protos.map((p) => p.id)]);
  });
  return counts;
}
