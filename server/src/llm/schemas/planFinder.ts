import { z } from "zod";

/** One concrete future plan found in a chat (DESIGN §15.3 A). Dates are YYYY-MM-DD; amounts are dollars exactly as written. */
export const PlanFinderOutput = z.object({
  plans: z.array(
    z.object({
      date: z.string(),
      time: z.string().optional(),
      description: z.string(),
      venue: z.string().optional(),
      peopleIds: z.array(z.string()),
      /** A per-person price the text states ("$12 a head", "$45 each"). Never computed. */
      perPersonAmountDollars: z.number().optional(),
      /** Who is paying for the whole thing, only if a message says so ("my treat", "I'm buying"). */
      payerId: z.string().optional(),
      sourceMessageIds: z.array(z.string()),
    }),
  ),
});
export type PlanFinderOutput = z.infer<typeof PlanFinderOutput>;
