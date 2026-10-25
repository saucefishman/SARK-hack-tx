import { slug } from "./util";
import { WebCostOutput, WebCostExtract } from "../schemas/webCost";
import type { WebSearchPromptDef } from "../webSearch";

export interface WebCostInput {
  /** The venue/business name: the merchant if known, else the event description. */
  venue: string;
  eventType?: string;
}

/** Two-step prompt: a web-search-grounded free-text call, then a structured extraction over its text. */
export const webCost: WebSearchPromptDef<WebCostInput, WebCostOutput, WebCostExtract> = {
  id: "webCost",
  version: "1",
  schema: WebCostOutput,
  extractSchema: WebCostExtract,
  // Cache by venue + event type (DESIGN 6c), never by date or attendee count.
  cacheInput: (i) => ({ venue: i.venue.trim().toLowerCase(), eventType: i.eventType?.trim().toLowerCase() ?? null }),
  fixtureKey: (i) => slug(i.eventType ? `${i.venue}-${i.eventType}` : i.venue),
  renderSearch: (i) =>
    `What is the typical price per person in US dollars for: ${i.venue}${i.eventType ? ` (${i.eventType})` : ""}, in Austin, Texas if it is a local business?
Search the web (the venue's own site or a review site is best). Answer in two or three sentences and quote any prices exactly as the pages state them. If no price can be found, say so plainly.`,
  renderExtract: (i, grounded) =>
    `From the search answer below, extract the typical price PER PERSON in US dollars for: ${i.venue}${i.eventType ? ` (${i.eventType})` : ""}.

Global rules:
- Never do arithmetic. Report the per-person price only exactly as the text states it, as a plain number of dollars. If the text gives a range, report its lower bound as written. If it only gives a group or total price, omit perPersonDollars.
- sourceIndex must be the number of one of the listed sources that supports the price. Never invent one. Omit it if none fits.
- confidence is 0..1 for how well the sources support the figure (a venue's own price list ~0.8, a vague review ~0.4).
- Omit fields you do not know.

Output JSON {"perPersonDollars"?: number, "sourceIndex"?: number, "confidence": number}.

Search answer:
${grounded.text}

Sources:
${grounded.sources.map((s, n) => `${n}: ${s.title ?? "(untitled)"} ${s.uri}`).join("\n") || "(none)"}`,
  finalize: (extract, grounded) => {
    const src = extract.sourceIndex !== undefined ? grounded.sources[extract.sourceIndex] : undefined;
    if (!src) return null;
    return {
      ...(extract.perPersonDollars !== undefined ? { perPersonDollars: extract.perPersonDollars } : {}),
      sourceUrl: src.uri,
      ...(src.title ? { sourceTitle: src.title } : {}),
      confidence: extract.confidence,
    };
  },
};
