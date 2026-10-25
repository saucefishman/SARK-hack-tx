import type { PromptDef } from "../types";
import { TxnSocialOutput } from "../schemas/txnSocial";
import { json, slug } from "./util";

export interface TxnSocialInput {
  txnId: string;
  merchant: string;
  category: string;
  amountDollars: number;
  date: string;
  siblings: { merchant: string; amountDollars: number }[];
}

export const txnSocial: PromptDef<TxnSocialInput, TxnSocialOutput> = {
  id: "txnSocial",
  version: "1",
  schema: TxnSocialOutput,
  fixtureKey: (i) => slug(i.txnId),
  render: (i) => `Decide whether a bank purchase looks like a SOCIAL expense (likely shared with other people: restaurant, bar, event tickets, group activity) versus a solo/utility expense (groceries, rent, gas, subscriptions, transit, personal shopping).
Do not do arithmetic. Use merchant, category, amount and the other same-day transactions as hints.

Output JSON {"looksSocial": boolean, "reason": string} with a one-sentence reason.

Transaction:
${json({ merchant: i.merchant, category: i.category, amountDollars: i.amountDollars, date: i.date })}
Other transactions the same day:
${json(i.siblings)}`,
};
