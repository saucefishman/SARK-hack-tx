// Review answers (BUILDPLAN Phase 4 step 8): persist the answer, then re-run ONLY the affected event through
// relevance -> attribution -> ledger. No LLM is involved (history deps only), so this is safe in replay mode.
//  - payer:     the chosen payer replaces the assumed event_payer/ledger rows with `confirmed` ones
//  - attendees: the answer sets the event's attendees; txn + human answer is the second source
//  - alias:     the candidate alias is attached to the chosen person (message senders updated too)
//  - dismiss:   marks the item dismissed (attendees: not social; payer: guess rejected, event excluded)
import { USER_ID, type ReviewAnswerBody } from "@sark/shared";
import type { Db } from "../db/pool";
import { attributeEvent } from "./attribution";
import { normAlias } from "./ingest";
import { rebuildEventLedger } from "./ledger";
import { evaluateEvent } from "./relevance";

/** Relevance -> attribution -> ledger for one event; returns friend ids whose rows changed. */
export async function reprocessEvent(db: Db, eventId: string): Promise<string[]> {
  const before = await db.query<{ payer_id: string; beneficiary_id: string | null }>(
    "SELECT payer_id, beneficiary_id FROM ledger_entry WHERE event_id = $1",
    [eventId],
  );
  await evaluateEvent(db, eventId);
  await attributeEvent(db, eventId);
  const { touched } = await rebuildEventLedger(db, eventId);
  const ids = new Set<string>(touched);
  for (const r of before.rows) {
    ids.add(r.payer_id);
    if (r.beneficiary_id) ids.add(r.beneficiary_id);
  }
  return [...ids];
}

/** Records the answer, re-runs the affected event, and returns affected friend ids. */
export async function applyReviewAnswer(db: Db, reviewId: string, body: ReviewAnswerBody): Promise<string[]> {
  const { rows } = await db.query<{ kind: string; event_id: string | null; question: string }>(
    "SELECT kind, event_id, question FROM review_item WHERE id = $1",
    [reviewId],
  );
  const item = rows[0];
  const ids = new Set<string>([...(body.personIds ?? []), ...(body.payerId ? [body.payerId] : [])]);

  await db.query("UPDATE review_item SET status = $2, answer = $3::jsonb WHERE id = $1", [
    reviewId,
    body.dismiss ? "dismissed" : "answered",
    JSON.stringify(body),
  ]);

  if (item?.kind === "alias" && !body.dismiss) {
    const personId = body.payerId ?? body.personIds?.[0];
    const name = /^Who is "(.*)"\?/.exec(item.question)?.[1];
    if (personId && name) {
      const v = normAlias(name);
      await db.query(
        "UPDATE person_alias SET person_id = $1, status = 'confirmed' WHERE person_id IS NULL AND status = 'candidate' AND value = $2",
        [personId, v],
      );
      await db.query(
        "UPDATE message SET sender_id = $1 WHERE sender_id IS NULL AND lower(trim(sender_name)) = $2",
        [personId, v],
      );
      ids.add(personId);
    }
  } else if (item?.event_id) {
    for (const f of await reprocessEvent(db, item.event_id)) ids.add(f);
  }
  ids.delete(USER_ID);
  return [...ids];
}
