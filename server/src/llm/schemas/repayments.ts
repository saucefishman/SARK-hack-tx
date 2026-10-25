import { z } from "zod";

export const RepaymentsOutput = z.object({
  repayments: z.array(
    z.object({
      messageId: z.string(),
      fromId: z.string(),
      toId: z.string(),
      amountDollars: z.number().optional(),
      eventId: z.string().optional(),
      note: z.string(),
    }),
  ),
});
export type RepaymentsOutput = z.infer<typeof RepaymentsOutput>;
