// Stage 6 (DESIGN 6 step 6, 6d): event_payer + attendees -> directional ledger_entry rows via splitEvent.
// Idempotent per event: delete the event's entries, reinsert. Only edges touching the user are kept (split.ts).
import type { Db } from "../db/pool";
import { stableId } from "../domain/ids";
import { splitEvent } from "../domain/split";

type Basis = "confirmed" | "assumed" | "estimated";
/** Confidence ceiling per basis; the event's merge confidence can only lower it. */
const BASIS_CAP: Record<Basis, number> = { confirmed: 1, estimated: 0.6, assumed: 0.4 };

/** Rebuild one event's ledger rows; returns the friend ids touched before or after (for UI refresh). */
export async function rebuildEventLedger(db: Db, id: string): Promise<{ entries: number; touched: string[] }> {
  const touched = new Set<string>();
  const { rows: old } = await db.query<{ payer_id: string; beneficiary_id: string | null }>(
    "SELECT payer_id, beneficiary_id FROM ledger_entry WHERE event_id = $1",
    [id],
  );
  for (const o of old) {
    touched.add(o.payer_id);
    if (o.beneficiary_id) touched.add(o.beneficiary_id);
  }
  const { rows: er } = await db.query<{ attendee_ids: string[]; is_relevant: boolean; confidence: number }>(
    "SELECT attendee_ids, is_relevant, confidence FROM event WHERE id = $1",
    [id],
  );
  const ev = er[0];
  const { rows: pays } = await db.query<{
    person_id: string; amount_cents: number | null; basis: Basis; evidence_message_id: string | null; txn_id: string | null;
  }>("SELECT person_id, amount_cents, basis, evidence_message_id, txn_id FROM event_payer WHERE event_id = $1 ORDER BY person_id", [id]);

  const rows: {
    id: string; payer: string; ben: string | null; amount: number; kind: "covered" | "unaccounted"; basis: Basis; conf: number;
    msg: string | null; txn: string | null;
  }[] = [];
  if (ev?.is_relevant && pays.length) {
    const known = pays.filter((p) => p.amount_cents !== null);
    if (known.length) {
      const { pairs } = splitEvent({
        attendeeIds: ev.attendee_ids,
        payers: known.map((p) => ({ personId: p.person_id, amountCents: p.amount_cents! })),
      });
      for (const pair of pairs) {
        const payer = known.find((p) => p.person_id === pair.creditorId);
        const basis = payer?.basis ?? "confirmed";
        rows.push({
          id: stableId("le", id, pair.creditorId, pair.debtorId, "covered"),
          payer: pair.creditorId, ben: pair.debtorId, amount: pair.amountCents, kind: "covered", basis,
          conf: Math.min(ev.confidence, BASIS_CAP[basis]), msg: payer?.evidence_message_id ?? null, txn: payer?.txn_id ?? null,
        });
      }
    }
    // Payer known but the amount could not be determined: surfaced (amount 0), never silently dropped.
    for (const p of pays.filter((x) => x.amount_cents === null)) {
      rows.push({
        id: stableId("le", id, p.person_id, "unaccounted"), payer: p.person_id, ben: null, amount: 0, kind: "unaccounted",
        basis: p.basis, conf: 0.2, msg: p.evidence_message_id, txn: p.txn_id,
      });
    }
  }
  await db.tx(async (tx) => {
    await tx.query("DELETE FROM ledger_entry WHERE event_id = $1", [id]);
    for (const r of rows) {
      await tx.query(
        `INSERT INTO ledger_entry (id, event_id, payer_id, beneficiary_id, amount_cents, kind, basis, confidence, evidence_message_id, txn_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [r.id, id, r.payer, r.ben, r.amount, r.kind, r.basis, r.conf, r.msg, r.txn],
      );
      touched.add(r.payer);
      if (r.ben) touched.add(r.ben);
    }
  });
  return { entries: rows.length, touched: [...touched] };
}

export interface LedgerCounts {
  events: number;
  covered: number;
  unaccounted: number;
  repayments: number;
}

/** Rebuild every event's covered/unaccounted rows. Repayment rows (event_id null) are owned by attribution. */
export async function runLedger(db: Db): Promise<LedgerCounts> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM event ORDER BY date, id");
  for (const r of rows) await rebuildEventLedger(db, r.id);
  const { rows: c } = await db.query<{ kind: string; n: string }>("SELECT kind, count(*) AS n FROM ledger_entry GROUP BY kind");
  const n = (k: string) => Number(c.find((x) => x.kind === k)?.n ?? 0);
  return { events: rows.length, covered: n("covered"), unaccounted: n("unaccounted"), repayments: n("repayment") };
}
