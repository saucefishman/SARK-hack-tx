import type { FriendEntry, PaybackItem, PaybackSuggestion } from '@sark/shared';
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

// "Your turn" framing (friendship first, money as a footnote) for payback suggestion cards.

function placeName(description: string) {
  // "Dinner at Uchi" -> "Uchi"; named outings like "Hamilton at Bass Concert Hall" stay whole.
  const meal = description.match(/^(?:dinner|lunch|brunch|breakfast|drinks|coffee)\s+at\s+(.+)$/i);
  return (meal ? meal[1] : description).replace(/\s+purchase$/i, '').trim();
}

/** Why this friend: the last outings they covered for the user, e.g. "Alex covered you for Uchi and Franklin BBQ lately." */
export function memoryHook(entries: FriendEntry[], friendName: string): string | null {
  const places: string[] = [];
  for (const entry of [...entries].sort((a, b) => (b.event?.date ?? '').localeCompare(a.event?.date ?? ''))) {
    if (entry.kind !== 'covered' || entry.payerName !== friendName || !entry.event) continue;
    const place = placeName(entry.event.description);
    if (place && !places.includes(place)) places.push(place);
    if (places.length === 2) break;
  }
  if (!places.length) return null;
  return `${friendName} covered you for ${places.join(' and ')} lately.`;
}

/** What treating the friend to this item does to the debt, phrased as a footnote. */
export function shareFootnote(item: PaybackItem, debtCents: number, toleranceCents = 0): string {
  const share = priceRange(item.friendShareLowCents, item.friendShareHighCents);
  const prefix = item.basis === 'estimated' ? 'About ' : '';
  return Math.abs(debtCents - item.friendShareHighCents) <= toleranceCents
    ? `${prefix}${share} for their part, which covers what you owe.`
    : item.friendShareHighCents > debtCents
      ? `${prefix}${share} for their part, more than the ${formatCents(debtCents)} you owe.`
      : `${prefix}${share} for their part, toward the ${formatCents(debtCents)} you owe.`;
}

export const yourTurnLabel = (friendName: string) => `Your turn with ${friendName}`;
export const sendInstead = (debtCents: number) => `Or just send ${formatCents(debtCents)} instead.`;
export const evenTogether = (friendName: string) => `You and ${friendName} are even. Make time for each other anyway.`;
