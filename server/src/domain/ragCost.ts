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

const DOLLARS = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
const PER_PERSON_AFTER = /^\s*(?:a head|per head|\/\s?head|each|apiece|a pop|per person|a person|\/\s?person|pp\b|per pax)/i;
const dollarsOf = (m: RegExpMatchArray) => Number(`${m[1]!.replace(/,/g, "")}.${m[2] ?? "0"}`);

/** Dollar amounts written in a text ("$20", "$ 12.50", "$1,200"), as numbers. */
export function dollarAmountsIn(text: string): number[] {
  return [...text.matchAll(DOLLARS)].map(dollarsOf);
}

/** True when the text writes `dollars` immediately followed by a per-person phrase ("$20 a head", "$25 each"). */
export function statedPerPerson(text: string, dollars: number): boolean {
  return [...text.matchAll(DOLLARS)].some((m) => dollarsOf(m) === dollars && PER_PERSON_AFTER.test(text.slice(m.index! + m[0].length)));
}

/**
 * Guard for "the LLM never does arithmetic": keep a quote's price fields only if that exact dollar figure appears in the
 * message's own text (looked up by id, not the model's `text` echo). A computed figure ($20 a head -> "$60" for 3 people)
 * or one borrowed from another snippet is dropped; a quote left with no price is dropped. Bodies unknown -> unchanged.
 * A figure filed as totalDollars (no headcount) that the text writes as per-person ("$20 a head") is moved to
 * perPersonDollars: Muse at low reasoning sometimes picks the wrong field.
 */
export function quotesStatedInText(quotes: RagQuote[], bodyOf: Map<string, string>): RagQuote[] {
  const out: RagQuote[] = [];
  for (const q of quotes) {
    const body = bodyOf.get(q.messageId);
    if (body === undefined) {
      out.push(q);
      continue;
    }
    const stated = dollarAmountsIn(body);
    const ok = (v: number | undefined) => v !== undefined && stated.includes(v);
    const { perPersonDollars, totalDollars, headcountStated, ...rest } = q;
    if (perPersonDollars === undefined && headcountStated === undefined && ok(totalDollars) && statedPerPerson(body, totalDollars!)) {
      out.push({ ...rest, perPersonDollars: totalDollars });
      continue;
    }
    const kept: RagQuote = {
      ...rest,
      ...(ok(perPersonDollars) ? { perPersonDollars } : {}),
      ...(ok(totalDollars) ? { totalDollars, ...(headcountStated !== undefined ? { headcountStated } : {}) } : {}),
    };
    if (kept.perPersonDollars !== undefined || kept.totalDollars !== undefined) out.push(kept);
  }
  return out;
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
