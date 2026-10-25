import type { PromptDef } from "../types";
import { MergeDayOutput } from "../schemas/mergeDay";
import { json, RULES, type ValidatedPromptDef } from "./util";

export interface MergeDayInput {
  date: string;
  people: { id: string; name: string }[];
  protoEvents: {
    id: string;
    source: "calendar" | "message" | "txn";
    time?: string;
    description?: string;
    peopleIds: string[];
    details: Record<string, unknown>;
  }[];
}

/** Every proto event id must appear in exactly one group. Throws otherwise. */
export function validateMergeGroups(input: MergeDayInput, output: MergeDayOutput): void {
  const known = new Set(input.protoEvents.map((p) => p.id));
  const seen = new Map<string, number>();
  for (const g of output.groups) {
    for (const id of g.protoEventIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const id of seen.keys()) if (!known.has(id)) problems.push(`unknown proto event id "${id}"`);
  for (const [id, n] of seen) if (n > 1) problems.push(`proto event "${id}" appears ${n} times`);
  for (const id of known) if (!seen.has(id)) problems.push(`proto event "${id}" is missing from all groups`);
  if (problems.length) throw new Error(`mergeDay groups invalid: ${problems.join("; ")}`);
}

export const mergeDay: ValidatedPromptDef<MergeDayInput, MergeDayOutput> = {
  id: "mergeDay",
  version: "1",
  schema: MergeDayOutput,
  fixtureKey: (i) => i.date,
  validate: validateMergeGroups,
  render: (i) => `You merge proto events from different sources (calendar, chat messages, bank transactions) that describe the SAME real-world outing on ${i.date}.

${RULES}

Group proto events that are the same outing (matching time/place/people). Different outings (e.g. lunch vs dinner) stay in separate groups. A proto event alone is its own group.
CRITICAL: every proto event id must appear in exactly one group (no omissions, no duplicates, no invented ids).

Output JSON {"groups": [...]}. Each group:
- protoEventIds: ids merged here.
- description: short merged description.
- time: "HH:MM" if known.
- attendeeIds: union of attendees across the merged events as supported by the evidence (include "p_me" if the user was there).
- payers: who paid. {personId, amountDollars?, basis}. basis "confirmed" = a bank txn or explicit message with amount; "assumed" = social event with no payment evidence, you guess a payer; "estimated" = payer explicit but no amount known. amountDollars only as stated in the details, never computed.
- totalDollars: bill total only if stated in the details.
- confidence: 0..1 that this grouping and attendee list is right.

People:
${json(i.people)}
Proto events:
${json(i.protoEvents)}`,
};
