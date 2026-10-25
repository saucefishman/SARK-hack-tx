// Stage 4 (DESIGN 6 step 4): binary relevance + attendee review items.
//  is_relevant = attendees >= 2 AND paid (an assumed payer counts) AND source_count >= 2 (domain/relevance.isRelevant).
//  A transaction-only social event with no similar past txn opens an `attendees` review item.
//  An answered attendees item supplies the attendees and counts as a second source (txn + human answer).
// Per-event and idempotent: reruns recompute from event rows + answered review items.
import { USER_ID } from "@sark/shared";
import type { Db } from "../db/pool";
import { stableId } from "../domain/ids";
import { formatCents } from "../domain/money";
import { isRelevant, needsAttendeeReview } from "../domain/relevance";

export interface RelevanceResult {
  eventId: string;
  relevant: boolean;
  attendeeIds: string[];
  sourceCount: number;
  reviewItemId: string | null;
}

export const attendeesReviewId = (txnId: string) => stableId("rv_attendees", txnId);

/** Recompute relevance for one event; writes event.attendee_ids/source_count/is_relevant and the review item. */
export async function evaluateEvent(db: Db, id: string): Promise<RelevanceResult | null> {
  const { rows } = await db.query<{
    id: string; d: string; description: string; attendee_ids: string[]; source_count: number; anchor_txn_id: string | null;
  }>(
    "SELECT id, to_char(date,'YYYY-MM-DD') AS d, description, attendee_ids, source_count, anchor_txn_id FROM event WHERE id = $1",
    [id],
  );
  const ev = rows[0];
  if (!ev) return null;

  const { rows: src } = await db.query<{ source: string; looks_social: boolean | null }>(
    `SELECT DISTINCT p.source, (p.details->>'looks_social')::boolean AS looks_social
     FROM event_source es JOIN proto_event p ON p.id = es.proto_event_id WHERE es.event_id = $1`,
    [id],
  );
  const sources = [...new Set(src.map((s) => s.source))];
  const baseCount = sources.length || ev.source_count; // events without provenance keep their stored count
  const { rows: paid } = await db.query("SELECT 1 FROM event_payer WHERE event_id = $1 LIMIT 1", [id]);

  let attendeeIds = ev.attendee_ids;
  let sourceCount = baseCount;
  let reviewItemId: string | null = null;

  if (ev.anchor_txn_id) {
    const { rows: t } = await db.query<{ merchant: string | null; description: string | null; amount_cents: number }>(
      "SELECT merchant, description, amount_cents FROM txn WHERE id = $1",
      [ev.anchor_txn_id],
    );
    const txn = t[0];
    const rid = attendeesReviewId(ev.anchor_txn_id);
    const { rows: existing } = await db.query<{ status: string; answer: { personIds?: string[] } | null }>(
      "SELECT status, answer FROM review_item WHERE id = $1",
      [rid],
    );
    const item = existing[0];
    if (item?.status === "answered" && item.answer?.personIds) {
      // Human answer: attendees as given (+ the user), and the answer is a second source.
      attendeeIds = [...new Set([USER_ID, ...item.answer.personIds])].sort();
      sourceCount = baseCount + 1;
    } else {
      const txnProtoSocial = src.some((s) => s.source === "txn" && s.looks_social === true);
      const { rows: past } = txn?.merchant
        ? await db.query(
            "SELECT 1 FROM txn WHERE kind = 'purchase' AND lower(merchant) = lower($1) AND occurred_on < $2 AND id <> $3 LIMIT 1",
            [txn.merchant, ev.d, ev.anchor_txn_id],
          )
        : { rows: [] };
      const needs = needsAttendeeReview({ sources, hasSimilarPastTxn: past.length > 0 }) && txnProtoSocial;
      if (needs && !item) {
        const { rows: friends } = await db.query<{ id: string }>("SELECT id FROM person WHERE is_user = false ORDER BY id");
        await db.query(
          `INSERT INTO review_item (id, kind, txn_id, event_id, question, option_ids) VALUES ($1, 'attendees', $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            rid, ev.anchor_txn_id, id,
            `We see ${formatCents(txn?.amount_cents ?? 0)} at ${txn?.merchant ?? txn?.description ?? "a merchant"} on ${ev.d}. Who was there?`,
            friends.map((f) => f.id),
          ],
        );
      }
      if (needs || item) reviewItemId = rid;
    }
    if (item) {
      reviewItemId = rid;
      await db.query("UPDATE review_item SET event_id = $2 WHERE id = $1", [rid, id]);
    }
  }

  const relevant = isRelevant({ attendeeIds, paid: paid.length > 0, sourceCount });
  await db.query("UPDATE event SET attendee_ids = $2, source_count = $3, is_relevant = $4 WHERE id = $1", [
    id, attendeeIds, sourceCount, relevant,
  ]);
  return { eventId: id, relevant, attendeeIds, sourceCount, reviewItemId };
}

export interface RelevanceCounts {
  events: number;
  relevant: number;
  excluded: number;
  attendeeReviews: number;
}

export async function runRelevance(db: Db): Promise<RelevanceCounts> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM event ORDER BY date, id");
  const counts: RelevanceCounts = { events: rows.length, relevant: 0, excluded: 0, attendeeReviews: 0 };
  for (const r of rows) {
    const res = await evaluateEvent(db, r.id);
    if (!res) continue;
    if (res.relevant) counts.relevant++;
    else counts.excluded++;
  }
  const { rows: open } = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM review_item WHERE kind = 'attendees' AND status = 'open'",
  );
  counts.attendeeReviews = Number(open[0].n);
  return counts;
}
