// Payback bundle solver (DESIGN §15.4). Pure: debt + priced options in, ranked bundles out. Integer cents, deterministic.
import { daysBetween } from "./recurrence";

export type OptionKind = "planned" | "recurring" | "discovered";

/** One priced way to spend on the friend. low/high are the FRIEND's share (what reduces the debt), in cents. */
export interface PaybackOption {
  id: string;
  kind: OptionKind;
  title: string;
  /** YYYY-MM-DD, or null when no date is known. */
  date: string | null;
  lowCents: number;
  highCents: number;
  /** 0..1: how much to believe the price. */
  confidence: number;
  /** 0..1: how much to believe the event happens (planned 1, recurring 0.7 x regularity, discovered 0.4). */
  trust: number;
  /** Bundles never hold two options with the same key. */
  activityKey?: string;
}

export interface PaybackConfig {
  asOf: string;
  tolerancePct: number;
  toleranceMinCents: number;
  maxBundle: number;
  /** Bundles returned (default 3). */
  limit?: number;
  /** Options kept before the subset search (default 25). */
  poolSize?: number;
  /** Days over which "soon" decays to zero (default 120). */
  horizonDays?: number;
}

export interface Bundle {
  optionIds: string[];
  lowCents: number;
  highCents: number;
  /** exact: the debt lies inside [low-tol, high+tol]. partial: covers part of it without overshooting. */
  kind: "exact" | "partial";
  score: number;
}

export interface PaybackResult {
  toleranceCents: number;
  bundles: Bundle[];
  /** True when no bundle settles the debt, so the UI offers a plain transfer alongside any partial bundle. */
  needsTransfer: boolean;
}

export const toleranceCents = (debtCents: number, c: Pick<PaybackConfig, "tolerancePct" | "toleranceMinCents">) =>
  Math.max(c.toleranceMinCents, Math.round((debtCents * c.tolerancePct) / 100));

const W = { closeness: 0.5, trust: 0.25, soon: 0.15, confidence: 0.1, sizePenalty: 0.03 };

function soonness(date: string | null, asOf: string, horizon: number): number {
  if (!date) return 0.5;
  return Math.max(0, 1 - Math.max(0, daysBetween(asOf, date)) / horizon);
}

/** Single-option usefulness, only used to prune the pool before the subset search. */
const prune = (o: PaybackOption, asOf: string, horizon: number) => o.trust * o.confidence * (0.5 + 0.5 * soonness(o.date, asOf, horizon));

function combos<T>(items: T[], maxSize: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, cur: T[]) => {
    if (cur.length) out.push([...cur]);
    if (cur.length === maxSize) return;
    for (let i = start; i < items.length; i++) {
      cur.push(items[i]!);
      walk(i + 1, cur);
      cur.pop();
    }
  };
  walk(0, []);
  return out;
}

function compatible(bundle: PaybackOption[]): boolean {
  const dates = new Set<string>();
  const keys = new Set<string>();
  for (const o of bundle) {
    if (o.date) {
      if (dates.has(o.date)) return false;
      dates.add(o.date);
    }
    if (o.activityKey) {
      if (keys.has(o.activityKey)) return false;
      keys.add(o.activityKey);
    }
  }
  return true;
}

export function solvePayback(debtCents: number, options: PaybackOption[], cfg: PaybackConfig): PaybackResult {
  const tol = toleranceCents(debtCents, cfg);
  if (debtCents <= 0) return { toleranceCents: tol, bundles: [], needsTransfer: false };
  const horizon = cfg.horizonDays ?? 120;
  const pool = [...options]
    .filter((o) => o.highCents >= o.lowCents && o.highCents > 0)
    .sort((a, b) => prune(b, cfg.asOf, horizon) - prune(a, cfg.asOf, horizon) || (a.id < b.id ? -1 : 1))
    .slice(0, cfg.poolSize ?? 25);

  const scored = combos(pool, cfg.maxBundle)
    .filter(compatible)
    .map((b) => {
      const low = b.reduce((s, o) => s + o.lowCents, 0);
      const high = b.reduce((s, o) => s + o.highCents, 0);
      // Distance from the debt to the bundle's price range; overshooting counts double (don't overpay a friend).
      const dist = debtCents < low ? (low - debtCents) * 2 : debtCents > high ? debtCents - high : 0;
      const closeness = Math.max(0, 1 - dist / debtCents);
      const score =
        W.closeness * closeness +
        W.trust * (b.reduce((s, o) => s + o.trust, 0) / b.length) +
        W.soon * (b.reduce((s, o) => s + soonness(o.date, cfg.asOf, horizon), 0) / b.length) +
        W.confidence * Math.min(...b.map((o) => o.confidence)) -
        W.sizePenalty * (b.length - 1);
      return { b, low, high, score, ids: b.map((o) => o.id).sort() };
    });
  const byScore = (x: { score: number; ids: string[] }, y: { score: number; ids: string[] }) =>
    y.score - x.score || (x.ids.join(",") < y.ids.join(",") ? -1 : 1);
  const toBundle = (x: (typeof scored)[number], kind: Bundle["kind"]): Bundle => ({
    optionIds: x.ids, lowCents: x.low, highCents: x.high, kind, score: Math.round(x.score * 1000) / 1000,
  });

  const limit = cfg.limit ?? 3;
  const exact = scored.filter((x) => debtCents >= x.low - tol && debtCents <= x.high + tol).sort(byScore).slice(0, limit);
  if (exact.length) return { toleranceCents: tol, bundles: exact.map((x) => toBundle(x, "exact")), needsTransfer: false };

  // Nothing settles it: offer the bundle that covers the most without overshooting, then a plain transfer for the rest.
  const partial = scored
    .filter((x) => x.high <= debtCents + tol)
    .sort((x, y) => y.high - x.high || byScore(x, y))
    .slice(0, 1);
  return { toleranceCents: tol, bundles: partial.map((x) => toBundle(x, "partial")), needsTransfer: true };
}
