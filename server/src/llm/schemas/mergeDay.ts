import { z } from "zod";

export const MergeGroup = z.object({
  protoEventIds: z.array(z.string()).min(1),
  description: z.string(),
  time: z.string().optional(),
  attendeeIds: z.array(z.string()),
  payers: z.array(
    z.object({
      personId: z.string(),
      amountDollars: z.number().optional(),
      basis: z.enum(["confirmed", "assumed", "estimated"]),
    }),
  ),
  totalDollars: z.number().optional(),
  confidence: z.number().min(0).max(1),
});

export const MergeDayOutput = z.object({ groups: z.array(MergeGroup) });
export type MergeDayOutput = z.infer<typeof MergeDayOutput>;
