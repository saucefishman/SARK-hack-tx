// Step math for the "debt drain": how a chosen payback plan pays down what the user owes, stop by stop. Pure.
import type { PaybackSuggestion } from '@sark/shared';
import { priceRange } from './payback-presentation';

export interface DrainStep {
  id: string;
  title: string;
  date: string | null;
  /** The friend's share as text, e.g. "$59" or "$20–$30". */
  amountLabel: string;
  /** Midpoint of the share range; the bar drains by this much. */
  midCents: number;
  /** What is still owed after this stop. Can go below zero if the plan overshoots. */
  remainingCents: number;
}

export interface Drain {
  steps: DrainStep[];
  /** Owed after the last stop (negative = overshoot). */
  endCents: number;
  /** The server judged the plan to settle the debt within tolerance. */
  settled: boolean;
}

/** Stops in the order the plan happens (undated ones last, in their given order). */
export function drainSteps(plan: PaybackSuggestion, debtCents: number): Drain {
  const dated = plan.items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.date ?? '9999').localeCompare(b.item.date ?? '9999') || a.i - b.i)
    .map((x) => x.item);
  let left = debtCents;
  const steps = dated.map((item): DrainStep => {
    const mid = Math.round((item.friendShareLowCents + item.friendShareHighCents) / 2);
    left -= mid;
    return {
      id: item.id,
      title: item.title,
      date: item.date,
      amountLabel: priceRange(item.friendShareLowCents, item.friendShareHighCents),
      midCents: mid,
      remainingCents: left,
    };
  });
  return { steps, endCents: left, settled: plan.kind === 'exact' };
}
