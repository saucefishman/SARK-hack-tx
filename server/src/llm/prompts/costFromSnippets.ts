import type { PromptDef } from "../types";
import { CostFromSnippetsOutput } from "../schemas/costFromSnippets";
import { json, RULES, slug } from "./util";

export interface CostFromSnippetsInput {
  merchant?: string;
  eventType?: string;
  description: string;
  date: string;
  snippets: { messageId: string; sentAt: string; text: string }[];
}

/** Fixture key depends only on the event, never on which snippets retrieval returned. */
export const costFromSnippetsKey = (i: { date: string; merchant?: string | null; description: string }) =>
  `${i.date}__${slug(i.merchant ?? i.description)}`;

export const costFromSnippets: PromptDef<CostFromSnippetsInput, CostFromSnippetsOutput> = {
  id: "costFromSnippets",
  version: "1",
  schema: CostFromSnippetsOutput,
  fixtureKey: costFromSnippetsKey,
  render: (i) => `We need to estimate what an outing cost per person. Below are earlier chat messages found by search. Pick out only the messages that state a price relevant to this outing.

${RULES}

Output JSON {"quotes": [...]}. One entry per snippet that states a price in dollars; skip snippets with no price.
Each quote:
- messageId: the snippet id.
- perPersonDollars: only if the text states a per-person price ("$20 a head", "$25 each", "$15/person"). Report it as written.
- totalDollars: only if the text states a total bill for the group ("tab was $90"). Report it as written. Never divide it yourself.
- headcountStated: only if the text says how many people the total covered ("for the four of us" -> 4).
- relevance: "same_venue" if the price is for the same venue/business as the outing below; "similar_event" if it is for the same kind of outing somewhere else; "unrelated" if it is about something else (rent, a different kind of purchase, a payback of an old debt).
- text: the words of the snippet that state the price.
An empty list is correct when no snippet states a relevant price.

Outing:
${json({ ...(i.merchant ? { merchant: i.merchant } : {}), ...(i.eventType ? { eventType: i.eventType } : {}), description: i.description, date: i.date })}
Snippets:
${json(i.snippets)}`,
};
