import type { PromptDef } from "../types";
import { PlanFinderOutput } from "../schemas/planFinder";
import { json, RULES, slug } from "./util";

export interface PlanFinderInput {
  /** "Today" (YYYY-MM-DD): plans must fall after it. */
  asOf: string;
  threadId: string;
  threadTitle: string;
  people: { id: string; name: string }[];
  /** Recent messages, oldest first. `date` is when it was sent; `weekday` is that date's day name. */
  messages: { id: string; senderId: string; date: string; weekday: string; time: string; text: string }[];
}

export const planFinder: PromptDef<PlanFinderInput, PlanFinderOutput> = {
  id: "planFinder",
  version: "1",
  schema: PlanFinderOutput,
  fixtureKey: (i) => `${i.asOf}__${slug(i.threadId)}`,
  render: (i) => `Find CONCRETE FUTURE PLANS in this chat: things the people in it intend to do together on a specific upcoming date.

${RULES}

Today is ${i.asOf}. Output JSON {"plans": [...]}. Each plan:
- date: YYYY-MM-DD, strictly after today. Resolve relative dates ("Friday", "next Saturday", "the 20th") against the date and weekday of the message that says it. If a date cannot be pinned down to one day, leave the plan out.
- time: HH:MM (24h) only if stated.
- description: short, e.g. "Trivia at Hole in the Wall". venue: only if named.
- peopleIds: who is going, using the ids below. Include "p_me" when the user is going.
- perPersonAmountDollars: only if a message states a per-person price ("$12 a head", "$45 each"). Never divide or multiply. Omit a total that is not per person.
- payerId: only if a message says who is paying for it ("my treat", "I'm buying the tickets"). Otherwise omit.
- sourceMessageIds: the messages that establish this plan.
Do NOT output: things that already happened, past-tense recollections, hypotheticals or vague ideas ("we should go sometime", "maybe someday"), or plans with no concrete date.
If the same plan is mentioned in several messages, output it once.

Thread: ${i.threadTitle}
People:
${json(i.people)}
Messages:
${json(i.messages)}`,
};
