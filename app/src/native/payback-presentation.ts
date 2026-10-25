import type { PaybackSuggestion } from '@sark/shared';
import { formatCents } from '../format';

export function priceRange(low: number, high: number) {
  return low === high ? formatCents(low) : `${formatCents(low)}–${formatCents(high)}`;
}

export function remainingBalance(plan: PaybackSuggestion, debt: number) {
  const low = debt - plan.totalHighCents;
  const high = debt - plan.totalLowCents;
  if (low === 0 && high === 0) return 'Covers your current balance';
  if (low >= 0) return `${priceRange(low, high)} left to cover`;
  if (high <= 0) return `${priceRange(-high, -low)} over your balance`;
  return `Up to ${formatCents(high)} left or ${formatCents(-low)} over`;
}

export function sourceUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}
