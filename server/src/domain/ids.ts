// Deterministic ids (DESIGN section 5). Pure: same inputs, same id.
import { createHash } from "node:crypto";

/** prefix + "_" + first 16 hex of sha256(parts joined by U+001F). */
export function stableId(prefix: string, ...parts: Array<string | number>): string {
  const h = createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 16);
  return `${prefix}_${h}`;
}

/** Event id from date + sorted attendees + anchor (txn/message/calendar id). Attendee order and duplicates ignored. */
export function eventId(e: { date: string; attendeeIds: string[]; anchor: string }): string {
  const attendees = [...new Set(e.attendeeIds)].sort();
  return stableId("ev", e.date, attendees.join(","), e.anchor);
}
