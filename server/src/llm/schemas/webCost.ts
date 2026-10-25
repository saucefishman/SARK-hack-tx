import { z } from "zod";

/** Final, cached result of the cold-start web search (what fixtures contain). */
export const WebCostOutput = z.object({
  /** Typical per-person price in dollars exactly as the sources state it. */
  perPersonDollars: z.number().optional(),
  /** A URL taken from the grounding metadata (never invented). */
  sourceUrl: z.string(),
  sourceTitle: z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export type WebCostOutput = z.infer<typeof WebCostOutput>;

/** What the extraction call returns; code maps `sourceIndex` onto the grounding sources to get the URL. */
export const WebCostExtract = z.object({
  perPersonDollars: z.number().optional(),
  /** Index into the numbered sources list that states the price. */
  sourceIndex: z.number().int().optional(),
  confidence: z.number().min(0).max(1),
});
export type WebCostExtract = z.infer<typeof WebCostExtract>;
