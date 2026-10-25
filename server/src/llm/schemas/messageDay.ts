import { z } from "zod";

export const PaymentMention = z.object({
  messageId: z.string(),
  fromId: z.string().optional(),
  toId: z.string().optional(),
  amountDollars: z.number().optional(),
  text: z.string(),
});

export const MessageDayEvent = z.object({
  date: z.string(),
  time: z.string().optional(),
  description: z.string(),
  peopleIds: z.array(z.string()),
  payerId: z.string().optional(),
  amountDollars: z.number().optional(),
  /** Stated per-person price (e.g. "$75 each"); code multiplies by headcount. */
  perPersonAmountDollars: z.number().optional(),
  /** Several payers, each with the amount the text states they paid (e.g. "I put $60 on my card"). */
  payers: z.array(z.object({ personId: z.string(), amountDollars: z.number().optional() })).optional(),
  coveredPhrases: z.array(z.string()),
  paymentMentions: z.array(PaymentMention),
  sourceMessageIds: z.array(z.string()),
});

export const MessageDayOutput = z.object({ events: z.array(MessageDayEvent) });
export type MessageDayOutput = z.infer<typeof MessageDayOutput>;
