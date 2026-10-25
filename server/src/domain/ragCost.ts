// Pure math for the RAG cost step: turn quotes the LLM reported (amounts exactly as written) into per-person cents.
// The LLM never divides or aggregates; this is where total/headcount and the median happen.
import { dollarsToCents } from "./money";
import { medianCents } from "./estimateBaseCost";

export interface RagQuote {
  messageId: string;
  perPersonDollars?: number;
  totalDollars?: number;
  headcountStated?: number;
  relevance: "same_venue" | "similar_event" | "unrelated";
}

/** Per-person cents for one quote: stated per-person price, else stated total / stated headcount (rounded). null if neither. */
export function quotePerPersonCents(q: RagQuote): number | null {
  if (q.perPersonDollars !== undefined && q.perPersonDollars > 0) return dollarsToCents(q.perPersonDollars);
  if (q.totalDollars !== undefined && q.totalDollars > 0 && q.headcountStated !== undefined && q.headcountStated > 0) {
    return Math.round(dollarsToCents(q.totalDollars) / q.headcountStated);
  }
  return null;
}

export interface RagPick {
  perPersonCents: number;
  /** Quote whose per-person value is closest to the median (ties: lowest message id). */
  evidenceMessageId: string;
  relevance: "same_venue" | "similar_event";
  used: number;
}

/**
 * Median per-person cents over the usable quotes: same_venue quotes if there are any, else similar_event. `unrelated` is ignored.
 * `allowedIds` restricts to message ids that were actually in the prompt (a model-invented id is dropped).
 */
export function pickPerPersonCents(quotes: RagQuote[], allowedIds?: Set<string>): RagPick | null {
  for (const relevance of ["same_venue", "similar_event"] as const) {
    const vals = quotes
      .filter((q) => q.relevance === relevance && (!allowedIds || allowedIds.has(q.messageId)))
      .map((q) => ({ id: q.messageId, c: quotePerPersonCents(q) }))
      .filter((x): x is { id: string; c: number } => x.c !== null);
    if (!vals.length) continue;
    const med = medianCents(vals.map((v) => v.c));
    const best = [...vals].sort((a, b) => Math.abs(a.c - med) - Math.abs(b.c - med) || (a.id < b.id ? -1 : 1))[0];
    return { perPersonCents: med, evidenceMessageId: best.id, relevance, used: vals.length };
  }
  return null;
}
