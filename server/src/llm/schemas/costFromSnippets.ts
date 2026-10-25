import { z } from "zod";

export const CostQuote = z.object({
  messageId: z.string(),
  /** A stated per-person price ("$20 a head", "$25 each"), dollars exactly as written. */
  perPersonDollars: z.number().optional(),
  /** A stated total bill for the whole group, dollars exactly as written. */
  totalDollars: z.number().optional(),
  /** Number of people the text says the total covered (only if stated). */
  headcountStated: z.number().int().optional(),
  relevance: z.enum(["same_venue", "similar_event", "unrelated"]),
  /** The words of the snippet that state the price. */
  text: z.string(),
});
export type CostQuote = z.infer<typeof CostQuote>;

export const CostFromSnippetsOutput = z.object({ quotes: z.array(CostQuote) });
export type CostFromSnippetsOutput = z.infer<typeof CostFromSnippetsOutput>;
