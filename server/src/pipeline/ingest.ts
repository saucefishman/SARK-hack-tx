// Ingest (BUILDPLAN Phase 2): sources -> person/person_alias/message/calendar_event/txn (+ alias review items).
// Idempotent: everything is an upsert on a stable key; rerunning changes nothing.
import { USER_ID, type AliasKind } from "@sark/shared";
import type { Db } from "../db/pool";
import { stableId } from "../domain/ids";
import type { CalendarSource, MessageSource, NessieSource } from "../sources/types";
import type { PeopleSource } from "../sources/people";

export interface IngestSources {
  people: PeopleSource;
  messages: MessageSource;
  calendar: CalendarSource;
  nessie: NessieSource;
}

export interface IngestCounts {
  persons: number;
  aliases: number;
  messages: number;
  calendarEvents: number;
  txns: number;
  /** Distinct unknown name strings that got a candidate alias + review item this run. */
  aliasReviews: number;
}

/** Aliases are stored lowercased, trimmed, single-spaced. */
export const normAlias = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

/** person_id for an alias (first matching kind wins); null if unknown or only a candidate. */
export async function resolvePerson(db: Db, kind: AliasKind | AliasKind[], value: string): Promise<string | null> {
  const v = normAlias(value);
  for (const k of Array.isArray(kind) ? kind : [kind]) {
    const { rows } = await db.query<{ person_id: string }>(
      "SELECT person_id FROM person_alias WHERE kind = $1 AND value = $2 AND person_id IS NOT NULL",
      [k, v],
    );
    if (rows[0]) return rows[0].person_id;
  }
  return null;
}

const NAME_KINDS: AliasKind[] = ["display_name", "nickname", "handle"];

/** Earliest non-user person whose name/nickname appears as a whole word in free text (e.g. a transfer description). */
export async function findNamedFriend(db: Db, text: string): Promise<string | null> {
  const { rows } = await db.query<{ person_id: string; value: string }>(
    `SELECT a.person_id, a.value FROM person_alias a JOIN person p ON p.id = a.person_id
     WHERE p.is_user = false AND a.kind = ANY($1)`,
    [NAME_KINDS],
  );
  const hay = text.toLowerCase();
  let best: { id: string; at: number } | null = null;
  for (const r of rows) {
    const m = new RegExp(`(^|[^a-z0-9])${r.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).exec(hay);
    if (m && (!best || m.index < best.at)) best = { id: r.person_id, at: m.index };
  }
  return best?.id ?? null;
}

export async function ingest(db: Db, src: IngestSources): Promise<IngestCounts> {
  const counts: IngestCounts = { persons: 0, aliases: 0, messages: 0, calendarEvents: 0, txns: 0, aliasReviews: 0 };
  const reviewed = new Set<string>();

  // --- people + aliases
  const people = await src.people.listPeople();
  const userId = people.find((p) => p.isUser)?.id ?? USER_ID;
  for (const p of people) {
    await db.query(
      `INSERT INTO person (id, display_name, is_user) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, is_user = EXCLUDED.is_user`,
      [p.id, p.displayName, p.isUser],
    );
    counts.persons++;
    const aliases = [{ kind: "display_name" as AliasKind, value: p.displayName }, ...p.aliases];
    for (const a of aliases) {
      // A candidate (person_id null) becomes confirmed; an existing confirmed mapping is never overwritten.
      await db.query(
        `INSERT INTO person_alias (person_id, kind, value, status) VALUES ($1, $2, $3, 'confirmed')
         ON CONFLICT (kind, value) DO UPDATE SET person_id = EXCLUDED.person_id, status = 'confirmed'
         WHERE person_alias.person_id IS NULL`,
        [p.id, a.kind, normAlias(a.value)],
      );
    }
  }
  counts.aliases = Number((await db.query<{ n: string }>("SELECT count(*) AS n FROM person_alias WHERE status = 'confirmed'")).rows[0].n);
  const friendIds = people.filter((p) => !p.isUser).map((p) => p.id).sort();

  /** Resolve a name string; unknown → candidate alias + one open review item. */
  async function resolveOrCandidate(kinds: AliasKind[], raw: string, seenIn: string): Promise<string | null> {
    const found = await resolvePerson(db, kinds, raw);
    if (found) return found;
    const v = normAlias(raw);
    if (!v) return null;
    const kind = kinds[0];
    await db.query(
      "INSERT INTO person_alias (person_id, kind, value, status) VALUES (NULL, $1, $2, 'candidate') ON CONFLICT (kind, value) DO NOTHING",
      [kind, v],
    );
    await db.query(
      `INSERT INTO review_item (id, kind, question, option_ids) VALUES ($1, 'alias', $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [stableId("rv_alias", kind, v), `Who is "${raw.trim()}"? Seen ${seenIn}.`, friendIds],
    );
    if (!reviewed.has(`${kind}:${v}`)) {
      reviewed.add(`${kind}:${v}`);
      counts.aliasReviews++;
    }
    return null;
  }

  // --- messages
  for await (const m of src.messages.listMessages()) {
    const senderId = await resolveOrCandidate(NAME_KINDS, m.senderName, `as a message sender in "${m.threadTitle}"`);
    await db.query(
      `INSERT INTO message (id, thread_id, sender_id, sender_name, sent_at, body) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET thread_id = EXCLUDED.thread_id, sender_id = EXCLUDED.sender_id,
         sender_name = EXCLUDED.sender_name, sent_at = EXCLUDED.sent_at, body = EXCLUDED.body`,
      [m.id, m.threadId, senderId, m.senderName, new Date(m.timestampMs).toISOString(), m.content],
    );
    counts.messages++;
  }

  // --- calendar
  for (const e of await src.calendar.listEvents()) {
    const ids: string[] = [];
    for (const a of e.attendees ?? []) {
      let id: string | null = null;
      if (a.email) id = await resolveOrCandidate(["email"], a.email, `as a calendar attendee in "${e.summary}"`);
      if (!id && a.displayName) id = await resolveOrCandidate(NAME_KINDS, a.displayName, `as a calendar attendee in "${e.summary}"`);
      if (id && !ids.includes(id)) ids.push(id);
    }
    await db.query(
      `INSERT INTO calendar_event (id, title, description, start_at, end_at, attendee_ids) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
         start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, attendee_ids = EXCLUDED.attendee_ids`,
      [e.id, e.summary, e.description ?? null, e.start.dateTime, e.end?.dateTime ?? null, ids],
    );
    counts.calendarEvents++;
  }

  // --- Nessie: customers → owner person; purchases from the user's accounts; transfers touching them
  const [customers, accounts, merchants] = await Promise.all([
    src.nessie.getCustomers(), src.nessie.getAccounts(), src.nessie.getMerchants(),
  ]);
  const customerPerson = new Map<string, string | null>();
  for (const c of customers) {
    customerPerson.set(
      c._id,
      (await resolvePerson(db, ["display_name", "nickname"], c.first_name)) ??
        (await resolvePerson(db, "display_name", `${c.first_name} ${c.last_name}`)),
    );
  }
  const accountPerson = new Map(accounts.map((a) => [a._id, customerPerson.get(a.customer_id) ?? null]));
  const userAccounts = accounts.filter((a) => accountPerson.get(a._id) === userId).map((a) => a._id);
  const merchantById = new Map(merchants.map((m) => [m._id, m]));

  const upsertTxn = (t: {
    nessieId: string; kind: "purchase" | "transfer"; amount: number; merchant: string | null; category: string | null;
    description: string | null; on: string; payerId: string;
  }) =>
    db.query(
      `INSERT INTO txn (id, nessie_id, kind, amount_cents, merchant, merchant_category, description, occurred_on, payer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (nessie_id) DO UPDATE SET kind = EXCLUDED.kind, amount_cents = EXCLUDED.amount_cents,
         merchant = EXCLUDED.merchant, merchant_category = EXCLUDED.merchant_category, description = EXCLUDED.description,
         occurred_on = EXCLUDED.occurred_on, payer_id = EXCLUDED.payer_id`,
      [`txn_${t.nessieId}`, t.nessieId, t.kind, t.amount * 100, t.merchant, t.category, t.description, t.on, t.payerId],
    );

  for (const acct of userAccounts) {
    for (const p of await src.nessie.getPurchases(acct)) {
      const m = merchantById.get(p.merchant_id);
      await upsertTxn({
        nessieId: p._id, kind: "purchase", amount: p.amount, merchant: m?.name ?? null,
        category: m?.category?.join(", ") ?? null, description: p.description ?? null, on: p.purchase_date, payerId: userId,
      });
      counts.txns++;
    }
  }
  const seenTransfers = new Set<string>();
  for (const a of accounts) {
    for (const t of await src.nessie.getTransfers(a._id)) {
      if (seenTransfers.has(t._id)) continue;
      seenTransfers.add(t._id);
      const payerOwner = accountPerson.get(t.payer_id) ?? null;
      // Live Nessie transfers carry no payee: one listed on a friend's account is taken as sent to the user.
      const payeeOwner = t.payee_id ? accountPerson.get(t.payee_id) ?? null : payerOwner && payerOwner !== userId ? userId : null;
      if (payerOwner !== userId && payeeOwner !== userId) continue; // not touching the user
      // Sender by account; if the sender account is unknown fall back to the friend named in the description.
      const named = t.description ? await findNamedFriend(db, t.description) : null;
      const payerId = payerOwner ?? (payeeOwner === userId ? named ?? userId : userId);
      await upsertTxn({
        nessieId: t._id, kind: "transfer", amount: t.amount, merchant: null, category: null,
        description: t.description ?? null, on: t.transaction_date, payerId,
      });
      counts.txns++;
    }
  }
  return counts;
}
