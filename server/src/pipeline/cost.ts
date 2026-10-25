// Real implementations of the expected-cost steps behind estimateBaseCost (DESIGN 6c):
//  - ragHistoryCost: semantic search over past messages -> costFromSnippets (LLM reports quoted prices) -> code takes the median
//  - webColdStartCost: Google-Search-grounded Gemini (two calls, see llm/webSearch.ts) -> per-person dollars + source URL
// Both are injected into BaseCostDeps (see dbBaseCostDeps in attribution.ts); the LLM never does arithmetic.
import type { Db } from "../db/pool";
import { dollarsToCents } from "../domain/money";
import type { BaseCostEvent, ColdStartCost } from "../domain/estimateBaseCost";
import { pickPerPersonCents } from "../domain/ragCost";
import { costFromSnippets, generateGrounded, generateStructured, webCost, type GenerateOptions, type WebSearchOptions } from "../llm";
import { searchMessages, type MessageSearch } from "./retrieval";

const STOP = new Set(["a", "an", "the", "at", "of", "for", "with", "and", "on", "in", "to", "my", "our", "i", "we"]);

/** Search query for the price of this venue/outing: the venue words plus "cost per person price". */
export function ragQuery(e: Pick<BaseCostEvent, "merchant" | "eventType" | "description">): string {
  const name = [e.merchant, e.eventType, e.merchant ? null : e.description]
    .filter((x): x is string => !!x)
    .join(" ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()))
    .join(" ");
  return `${name} cost per person price`.trim();
}

export interface RagHistoryResult {
  /** perPerson x headcount (cents). */
  amountCents: number;
  perPersonCents: number;
  evidenceMessageId: string;
  relevance: "same_venue" | "similar_event";
  quotesUsed: number;
}

export interface RagOptions {
  search?: MessageSearch;
  /** Hits to retrieve (default 8). */
  k?: number;
  /** Drop hits scoring below this (default: none; the LLM filters relevance). */
  minScore?: number;
  llm?: GenerateOptions;
}

/**
 * RAG history step: find past messages (strictly before the event, excluding its own context) that state what this venue or
 * kind of outing costs. Null when retrieval finds nothing (no LLM call) or no usable quote comes back.
 */
export async function ragHistoryCost(db: Db, event: BaseCostEvent, opts: RagOptions = {}): Promise<RagHistoryResult | null> {
  const search = opts.search ?? searchMessages;
  const hits = await search(db, ragQuery(event), {
    k: opts.k ?? 8,
    before: event.date,
    excludeMessageIds: event.contextMessageIds ?? [],
    ...(opts.minScore !== undefined ? { minScore: opts.minScore } : {}),
  });
  if (!hits.length) return null;

  const description = event.description ?? event.merchant ?? event.eventType;
  if (!description) return null;
  const out = await generateStructured(
    db,
    costFromSnippets,
    {
      ...(event.merchant ? { merchant: event.merchant } : {}),
      ...(event.eventType ? { eventType: event.eventType } : {}),
      description,
      date: event.date,
      snippets: hits.map((h) => ({ messageId: h.messageId, sentAt: h.sentAt, text: h.body })),
    },
    opts.llm,
  );
  const pick = pickPerPersonCents(out.quotes, new Set(hits.map((h) => h.messageId)));
  if (!pick) return null;
  const n = Math.max(1, event.headcount ?? 1);
  return {
    amountCents: pick.perPersonCents * n,
    perPersonCents: pick.perPersonCents,
    evidenceMessageId: pick.evidenceMessageId,
    relevance: pick.relevance,
    quotesUsed: pick.used,
  };
}

/** Cold-start web step as a `ColdStartCost` (cached by venue + event type in llm_cache; replays fixtures/webCost/*.json). */
export function webColdStartCost(db: Db, opts: WebSearchOptions = {}): ColdStartCost {
  return async ({ merchant, eventType, description }) => {
    const venue = merchant ?? description;
    if (!venue) return null;
    const out = await generateGrounded(db, webCost, { venue, ...(eventType ? { eventType } : {}) }, opts);
    if (!out || out.perPersonDollars === undefined || out.perPersonDollars <= 0 || !out.sourceUrl) return null;
    return {
      perPersonCents: dollarsToCents(out.perPersonDollars),
      sourceUrl: out.sourceUrl,
      ...(out.sourceTitle ? { sourceTitle: out.sourceTitle } : {}),
      confidence: out.confidence,
    };
  };
}
