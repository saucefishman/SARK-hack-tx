// Recurring-activity detection (DESIGN §15.3 B). Pure: occurrences in, patterns out. No DB, no LLM.
import { medianCents } from "./estimateBaseCost";

export interface Occurrence {
  /** Activity key (merchant or normalized description). */
  key: string;
  /** YYYY-MM-DD. */
  date: string;
  /** What the outing cost per person, if known. */
  perPersonCents: number | null;
  eventId: string;
}

export interface Pattern {
  key: string;
  occurrences: number;
  lastDate: string;
  medianGapDays: number;
  /** 0 = Sunday .. 6 = Saturday, when most occurrences fall on one weekday; else null. */
  weekday: number | null;
  /** 1 - MAD(gaps) / median(gaps), clamped to [0,1]. */
  regularity: number;
  /** First predicted date strictly after asOf. */
  nextDate: string;
  perPersonLowCents: number | null;
  perPersonMedianCents: number | null;
  perPersonHighCents: number | null;
  memberEventIds: string[];
}

export interface PatternOptions {
  /** Fewer occurrences are not a pattern (default 3). */
  minOccurrences?: number;
  /** Less regular patterns are dropped (default 0.5). */
  minRegularity?: number;
  /** A pattern whose last occurrence is more than this many gaps before asOf has lapsed (default 4). */
  staleGaps?: number;
}

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);
export const addDays = (d: string, n: number) => toDate(toMs(d) + n * DAY);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Share of occurrences on the most common weekday, and that weekday. Ties go to the lower weekday. */
function weekdayMode(dates: string[]): { weekday: number; share: number } {
  const counts = new Array<number>(7).fill(0);
  for (const d of dates) counts[new Date(toMs(d)).getUTCDay()]!++;
  let best = 0;
  for (let w = 1; w < 7; w++) if (counts[w]! > counts[best]!) best = w;
  return { weekday: best, share: counts[best]! / dates.length };
}

/** Nearest date to `d` (within +-3 days) that falls on `weekday`. */
function snapToWeekday(d: string, weekday: number): string {
  const cur = new Date(toMs(d)).getUTCDay();
  let delta = weekday - cur;
  if (delta > 3) delta -= 7;
  if (delta < -3) delta += 7;
  return addDays(d, delta);
}

/**
 * Group occurrences by key and predict each recurring one's next date after `asOf`.
 * Same-day duplicates of a key count once. The prediction rolls forward in whole gaps from the last occurrence, so a pattern
 * that "should have happened" while nobody was looking still yields a future date; patterns idle for more than `staleGaps` gaps are dropped.
 */
export function detectPatterns(occurrences: Occurrence[], asOf: string, opts: PatternOptions = {}): Pattern[] {
  const minOcc = opts.minOccurrences ?? 3;
  const minReg = opts.minRegularity ?? 0.5;
  const stale = opts.staleGaps ?? 4;
  const byKey = new Map<string, Occurrence[]>();
  for (const o of occurrences) (byKey.get(o.key) ?? byKey.set(o.key, []).get(o.key)!).push(o);

  const out: Pattern[] = [];
  for (const [key, all] of [...byKey].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const byDate = new Map<string, Occurrence>();
    for (const o of [...all].sort((a, b) => a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId))) {
      if (!byDate.has(o.date)) byDate.set(o.date, o);
    }
    const occ = [...byDate.values()];
    if (occ.length < minOcc) continue;
    const dates = occ.map((o) => o.date);
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
    const medGap = median(gaps);
    if (medGap <= 0) continue;
    const mad = median(gaps.map((g) => Math.abs(g - medGap)));
    const regularity = Math.min(1, Math.max(0, 1 - mad / medGap));
    if (regularity < minReg) continue;

    const lastDate = dates[dates.length - 1]!;
    const idle = daysBetween(lastDate, asOf);
    if (idle > stale * medGap) continue;
    const step = Math.max(1, Math.round(medGap));
    const wd = weekdayMode(dates);
    const snap = wd.share >= 0.6;
    let k = Math.max(1, Math.floor(idle / step));
    let next = lastDate;
    for (let guard = 0; guard < 1000; guard++, k++) {
      next = addDays(lastDate, k * step);
      if (snap) next = snapToWeekday(next, wd.weekday);
      if (next > asOf) break;
    }

    const priced = occ.map((o) => o.perPersonCents).filter((c): c is number => c !== null && c > 0);
    out.push({
      key,
      occurrences: occ.length,
      lastDate,
      medianGapDays: medGap,
      weekday: snap ? wd.weekday : null,
      regularity,
      nextDate: next,
      perPersonLowCents: priced.length ? Math.min(...priced) : null,
      perPersonMedianCents: priced.length ? medianCents(priced) : null,
      perPersonHighCents: priced.length ? Math.max(...priced) : null,
      memberEventIds: occ.map((o) => o.eventId),
    });
  }
  return out;
}
