// Relevance gate and review-queue trigger (DESIGN section 6, step 4). Pure.

/** is_relevant = attendees >= 2 AND paid AND source_count >= 2. */
export function isRelevant(e: { attendeeIds: string[]; paid: boolean; sourceCount: number }): boolean {
  return new Set(e.attendeeIds).size >= 2 && e.paid && e.sourceCount >= 2;
}

/** True when the only source is a transaction and no similar past txn exists: ask the user who was there. */
export function needsAttendeeReview(e: { sources: string[]; hasSimilarPastTxn: boolean }): boolean {
  return e.sources.length > 0 && e.sources.every((s) => s === "txn") && !e.hasSimilarPastTxn;
}
