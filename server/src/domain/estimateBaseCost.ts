// Expected-cost chain (DESIGN 6c): message-stated -> history median -> RAG over past messages -> cold-start web search -> null.
// Pure; deps injected. The real RAG / web steps live in pipeline/cost.ts (they need the DB and Gemini).

export interface ColdStartCost {
  (q: { merchant?: string | null; eventType?: string | null; description?: string | null }): Promise<{
    perPersonCents: number;
    sourceUrl: string;
    sourceTitle?: string;
    confidence: number;
  } | null>;
}

/** Offline default when no cold-start dep is injected (pure callers/tests): knows nothing. The real one is `webColdStartCost` in pipeline/cost.ts. */
const coldStartCost: ColdStartCost = async () => null;
export default coldStartCost;

export interface BaseCostEvent {
  statedAmountCents?: number | null;
  merchant?: string | null;
  eventType?: string | null;
  date: string;
  /** Needed to scale per-person costs (RAG, cold start); default 1. */
  headcount?: number;
  /** Event description (e.g. "Karaoke at Ego's"); query text when merchant is unknown. */
  description?: string | null;
  /** The event's own messages; RAG must not cite them. */
  contextMessageIds?: string[];
}

export interface BaseCostDeps {
  /** Past total amounts (cents) at same merchant/event type before `before`. */
  history: (q: { merchant?: string | null; eventType?: string | null; before: string }) => Promise<number[]>;
  /** RAG over past messages: a per-person price somebody stated for this venue / kind of outing. Returns the TOTAL (perPerson x headcount). */
  rag?: (e: BaseCostEvent) => Promise<{ amountCents: number; evidenceMessageId?: string | null } | null>;
  coldStart?: ColdStartCost;
  /** TODO(stub): social - canonical_event lookup (DESIGN 11b); unused in MVP. */
  canonical?: (e: BaseCostEvent) => Promise<{ amountCents: number } | null>;
}

export interface BaseCostResult {
  amountCents: number;
  basis: "confirmed" | "estimated";
  source: "message" | "history" | "rag" | "cold_start";
  /** Message that justifies the amount (RAG step). */
  evidenceMessageId?: string | null;
  /** Web source (cold-start step). */
  sourceUrl?: string;
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

  const rag = deps.rag ? await deps.rag(event) : null;
  if (rag && rag.amountCents > 0) {
    return { amountCents: rag.amountCents, basis: "estimated", source: "rag", evidenceMessageId: rag.evidenceMessageId ?? null };
  }

  const cold = await (deps.coldStart ?? coldStartCost)({ ...q, description: event.description });
  if (cold && cold.perPersonCents > 0) {
    const n = Math.max(1, event.headcount ?? 1);
    return { amountCents: cold.perPersonCents * n, basis: "estimated", source: "cold_start", sourceUrl: cold.sourceUrl };
  }
  return null;
}
