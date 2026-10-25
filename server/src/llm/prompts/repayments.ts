import type { PromptDef } from "../types";
import { RepaymentsOutput } from "../schemas/repayments";
import { json, RULES, slug } from "./util";

export interface RepaymentsInput {
  threadId: string;
  people: { id: string; name: string }[];
  outstanding: {
    eventId: string;
    description: string;
    date: string;
    debtorId: string;
    creditorId: string;
    amountDollars: number;
  }[];
  messages: { id: string; senderId: string; time: string; date: string; text: string }[];
}

export const repayments: PromptDef<RepaymentsInput, RepaymentsOutput> = {
  id: "repayments",
  version: "1",
  schema: RepaymentsOutput,
  fixtureKey: (i) => slug(i.threadId),
  render: (i) => `Find messages in a chat thread where someone pays someone back (venmo/zelle/cash/"sent you $X"/"we're even"). Repayments settle outstanding debts listed below.

${RULES}

Output JSON {"repayments": [...]}. Each:
- messageId: the message announcing the repayment.
- fromId: who paid; toId: who received.
- amountDollars: only if the text states it, exactly as written; never infer from the outstanding list.
- eventId: the outstanding debt's eventId this most plausibly settles, if clear; else omit.
- note: short explanation.
Ignore messages that are not repayments, and money mentions that are just planning or splitting a bill for a new outing.

People:
${json(i.people)}
Outstanding debts:
${json(i.outstanding)}
Messages:
${json(i.messages)}`,
};
