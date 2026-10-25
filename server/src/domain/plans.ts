// Future-plan rules (DESIGN §15.3 A). Pure: the model proposes plans, code decides which are acceptable and merges duplicates.
import { USER_ID } from "@sark/shared";
import type { PlanFinderOutput } from "../llm/schemas/planFinder";
import { addDays } from "./recurrence";

export type RawPlan = PlanFinderOutput["plans"][number];

export type RejectReason =
  | "bad_date"
  | "not_future"
  | "too_far"
  | "friend_paying"
  | "no_friend"
  | "no_source";

export interface AcceptContext {
  asOf: string;
  /** Plans further out than this many days are not offered (default 180). */
  horizonDays?: number;
  knownIds: Set<string>;
  /** Message ids actually in the prompt: a plan citing none of them is hallucinated. */
  messageIds: Set<string>;
}

export interface AcceptedPlan {
  date: string;
  time: string | null;
  description: string;
  venue: string | null;
  /** Known people only, the user included when listed. */
  peopleIds: string[];
  perPersonCents: number | null;
  sourceMessageIds: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
/** YYYY-MM-DD that exists on the calendar. Date.parse alone accepts "2026-02-30" (it rolls into March), so round-trip it. */
const realDate = (d: string) => ISO.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/**
 * Accept or reject one model-proposed plan. Rejects: unparseable or non-future dates, dates beyond the horizon, plans a friend
 * is paying for (that would add to the debt, not reduce it), plans with no known friend in them, and plans citing no real message.
 */
export function acceptMessagePlan(p: RawPlan, ctx: AcceptContext): { ok: true; plan: AcceptedPlan } | { ok: false; reason: RejectReason } {
  if (!realDate(p.date)) return { ok: false, reason: "bad_date" };
  if (p.date <= ctx.asOf) return { ok: false, reason: "not_future" };
  if (p.date > addDays(ctx.asOf, ctx.horizonDays ?? 180)) return { ok: false, reason: "too_far" };
  if (p.payerId && p.payerId !== USER_ID) return { ok: false, reason: "friend_paying" };
  const sources = p.sourceMessageIds.filter((id) => ctx.messageIds.has(id));
  if (!sources.length) return { ok: false, reason: "no_source" };
  const people = [...new Set(p.peopleIds.filter((id) => ctx.knownIds.has(id)))];
  if (!people.some((id) => id !== USER_ID)) return { ok: false, reason: "no_friend" };
  const cents = p.perPersonAmountDollars !== undefined && p.perPersonAmountDollars > 0 ? Math.round(p.perPersonAmountDollars * 100) : null;
  return {
    ok: true,
    plan: {
      date: p.date,
      time: p.time && CLOCK.test(p.time) ? p.time : null,
      description: p.description.trim(),
      venue: p.venue?.trim() || null,
      peopleIds: people,
      perPersonCents: cents,
      sourceMessageIds: sources,
    },
  };
}

/** One plan from either source, before merging. */
export interface PlanSource {
  /** Calendar event id, or a stable ref for a message plan. */
  ref: string;
  source: "calendar" | "message";
  title: string;
  date: string;
  time: string | null;
  peopleIds: string[];
  /** Per-person price the source states, if any. */
  statedPerPersonCents: number | null;
  /** Human-readable receipt for where the plan came from. */
  evidence: string;
}

const friendsOf = (p: PlanSource) => p.peopleIds.filter((id) => id !== USER_ID);

/**
 * Same day and a friend in common = the same plan. The calendar entry wins (it is the user's own record); a price or receipt
 * only the chat has is carried over so nothing is lost. Output order: by date, then ref.
 */
export function mergePlans(plans: PlanSource[]): PlanSource[] {
  const sorted = [...plans].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.source === b.source ? 0 : a.source === "calendar" ? -1 : 1) || a.ref.localeCompare(b.ref),
  );
  const out: PlanSource[] = [];
  for (const p of sorted) {
    const keep = out.find((q) => q.date === p.date && friendsOf(q).some((f) => friendsOf(p).includes(f)));
    if (!keep) {
      out.push({ ...p });
      continue;
    }
    if (keep.statedPerPersonCents === null && p.statedPerPersonCents !== null) keep.statedPerPersonCents = p.statedPerPersonCents;
    keep.evidence = `${keep.evidence} ${p.evidence}`;
    keep.peopleIds = [...new Set([...keep.peopleIds, ...p.peopleIds])].sort();
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}
