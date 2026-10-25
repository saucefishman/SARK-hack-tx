// Pure extraction of priced options from SerpAPI responses (DESIGN §15.3 C). No network, no LLM.
// Reads only fields the response states; a price level ("$$") maps to a fixed band, flagged low confidence.
// TODO(stub): serpapi-live: field names follow SerpAPI's documented google_events / google_maps shapes and are checked only
// against hand-written fixtures; confirm against a real response when the key (H13) exists.

export interface PricedPlace {
  title: string;
  /** Per-person price range in cents. */
  lowCents: number;
  highCents: number;
  /** "stated" = a dollar figure in the response; "level" = mapped from $/$$/$$$/$$$$. */
  source: "stated" | "level";
  /** Month-day text from an events result, e.g. "Nov 7"; null for places. */
  dateText: string | null;
  url: string | null;
  category: string | null;
}

/** Per-person cents bands for Google's price levels. Documented guesses, not data; they carry confidence 0.3. */
export const PRICE_LEVEL_BANDS: Record<string, [number, number]> = {
  $: [800, 1500],
  $$: [1500, 3000],
  $$$: [3000, 6000],
  $$$$: [6000, 12000],
};

const MONEY = /\$\s*(\d+(?:\.\d{1,2})?)(?:\s*(?:-|–|—|to)\s*\$?\s*(\d+(?:\.\d{1,2})?))?/;

/** First "$N" or "$N-M" in the text, as cents. */
export function parseDollarRange(text: string | undefined | null): [number, number] | null {
  if (!text) return null;
  const m = MONEY.exec(text);
  if (!m) return null;
  const a = Math.round(Number(m[1]) * 100);
  const b = m[2] ? Math.round(Number(m[2]) * 100) : a;
  return a > 0 && b >= a ? [a, b] : null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** google_events: `events_results[]`. Price comes from a stated dollar figure in price/ticket/description text, else the event is skipped. */
export function eventsFromSerp(resp: unknown): PricedPlace[] {
  const out: PricedPlace[] = [];
  for (const raw of arr(obj(resp).events_results)) {
    const e = obj(raw);
    const title = str(e.title);
    if (!title) continue;
    const texts = [str(e.price), ...arr(e.ticket_info).map((t) => str(obj(t).price)), str(e.description)];
    const range = texts.map(parseDollarRange).find((r) => r !== null) ?? null;
    if (!range) continue;
    out.push({
      title, lowCents: range[0], highCents: range[1], source: "stated", dateText: str(obj(e.date).start_date),
      url: str(e.link), category: null,
    });
  }
  return out;
}

/** google_maps: `local_results[]`. Price from a stated range ("$20–30"), else the $-level band. Unpriced places are skipped. */
export function placesFromSerp(resp: unknown): PricedPlace[] {
  const out: PricedPlace[] = [];
  for (const raw of arr(obj(resp).local_results)) {
    const p = obj(raw);
    const title = str(p.title);
    if (!title) continue;
    const priceText = str(p.price) ?? str(p.price_range);
    const stated = parseDollarRange(priceText);
    const level = priceText && /^\${1,4}$/.test(priceText) ? PRICE_LEVEL_BANDS[priceText] : undefined;
    const range = stated ?? level;
    if (!range) continue;
    out.push({
      title, lowCents: range[0], highCents: range[1], source: stated ? "stated" : "level", dateText: null,
      url: str(p.link) ?? str(p.website), category: str(p.type),
    });
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Nov 7" -> the first YYYY-MM-DD on or after asOf. Null if unparseable. */
export function resolveMonthDay(text: string | null, asOf: string): string | null {
  const m = text && /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1]!.toLowerCase());
  if (mon < 0) return null;
  const year = Number(asOf.slice(0, 4));
  for (const y of [year, year + 1]) {
    const d = `${y}-${String(mon + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
    if (d >= asOf && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return d;
  }
  return null;
}
