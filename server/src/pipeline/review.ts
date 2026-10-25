// TODO(stub): pipeline — replaced by the real review-answer handler.
import { USER_ID, type ReviewAnswerBody } from "@sark/shared";
import type { Db } from "../db/pool";

/** Records the answer and returns affected friend ids. Does not yet recompute the ledger. */
export async function applyReviewAnswer(db: Db, reviewId: string, body: ReviewAnswerBody): Promise<string[]> {
  const { rows } = await db.query<{ event_id: string | null }>("SELECT event_id FROM review_item WHERE id = $1", [
    reviewId,
  ]);
  const eventId = rows[0]?.event_id ?? null;
  const ids = new Set<string>([...(body.personIds ?? []), ...(body.payerId ? [body.payerId] : [])]);
  if (eventId) {
    const { rows: l } = await db.query<{ payer_id: string; beneficiary_id: string | null }>(
      "SELECT payer_id, beneficiary_id FROM ledger_entry WHERE event_id = $1",
      [eventId],
    );
    for (const r of l) {
      ids.add(r.payer_id);
      if (r.beneficiary_id) ids.add(r.beneficiary_id);
    }
  }
  ids.delete(USER_ID);
  await db.query("UPDATE review_item SET status = $2, answer = $3::jsonb WHERE id = $1", [
    reviewId,
    body.dismiss ? "dismissed" : "answered",
    JSON.stringify(body),
  ]);
  // TODO(stub): pipeline — re-run affected event through relevance → attribution → ledger
  return [...ids];
}
