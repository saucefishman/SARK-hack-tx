// Expected-cost chain (DESIGN 6c): message-stated -> history median -> cold-start -> null. Pure; deps injected.

export interface ColdStartCost {
  (q: { merchant?: string | null; eventType?: string | null }): Promise<{
    perPersonCents: number;
    sourceUrl: string;
    confidence: number;
  } | null>;
}

/** TODO(stub): muse-cold-start. Real version runs a web search; never touches the network here. */
const coldStartCost: ColdStartCost = async () => null;
export default coldStartCost;

export interface BaseCostEvent {
  statedAmountCents?: number | null;
  merchant?: string | null;
  eventType?: string | null;
  date: string;
  /** Needed to scale cold-start per-person cost (default 1). */
  headcount?: number;
}

export interface BaseCostDeps {
  /** Past total amounts (cents) at same merchant/event type before `before`. */
  history: (q: { merchant?: string | null; eventType?: string | null; before: string }) => Promise<number[]>;
  coldStart?: ColdStartCost;
  /** TODO(stub): social - canonical_event lookup (DESIGN 11b); unused in MVP. */
  canonical?: (e: BaseCostEvent) => Promise<{ amountCents: number } | null>;
}

export interface BaseCostResult {
  amountCents: number;
  basis: "confirmed" | "estimated";
  source: "message" | "history" | "cold_start";
}

/** Median in cents; even count -> floor of the mean of the two middle values. */
export function medianCents(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.floor((s[m - 1] + s[m]) / 2);
}

export async function estimateBaseCost(event: BaseCostEvent, deps: BaseCostDeps): Promise<BaseCostResult | null> {
  // TODO(stub): social - deps.canonical lookup goes here (no-op in MVP).
  if (event.statedAmountCents != null && event.statedAmountCents > 0) {
    return { amountCents: event.statedAmountCents, basis: "confirmed", source: "message" };
  }
  const q = { merchant: event.merchant, eventType: event.eventType };
  const past = (await deps.history({ ...q, before: event.date })).filter((n) => Number.isFinite(n) && n > 0);
  if (past.length) return { amountCents: medianCents(past), basis: "estimated", source: "history" };

  const cold = await (deps.coldStart ?? coldStartCost)(q);
  if (cold && cold.perPersonCents > 0) {
    const n = Math.max(1, event.headcount ?? 1);
    return { amountCents: cold.perPersonCents * n, basis: "estimated", source: "cold_start" };
  }
  return null;
}
