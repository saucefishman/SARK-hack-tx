import type { FriendEntry, PaybackItem } from '@sark/shared';

export type ActivityIdea = { id: string; title: string; source: PaybackItem['kind'] | 'history' | 'fallback' };

const sourceCopy = {
  planned: { description: 'Here’s something you’re already planning together.', basis: 'From your calendar or messages' },
  discovered: { description: 'Here’s a suggestion for something you could do together.', basis: 'Found through search' },
  recurring: { description: 'You’ve shared this before. How about doing it again?', basis: 'Based on your recurring activities' },
  history: { description: 'You’ve shared this before. Pick a day and make another memory of it.', basis: 'Inspired by your shared activity' },
  fallback: { description: 'Pick a favorite spot and a day that works for you both.', basis: 'A simple idea to get you started' },
};

export function activityIdeaCopy(source: ActivityIdea['source']) {
  return sourceCopy[source];
}

const REPEATABLE = /^(dinner|lunch|brunch|breakfast|drinks|coffee|tacos|pizza|happy hour|game night)\b/i;

function activityTitle(value: string) {
  const title = value.replace(/\s+purchase$/i, '').trim();
  return title && !/[$€£]|\b(payment|paid|repayments?|refunds?|transfers?|splits?|owes?|loans?|reimbursements?|settlement)\b/i.test(title) ? title : null;
}

// Preserve source labels for backend ideas, with shared outings as a fallback.
export function friendActivityIdeas(entries: FriendEntry[], friendId: string, suggestions: PaybackItem[] = []): ActivityIdea[] {
  const seen = new Set<string>();
  const ideas: ActivityIdea[] = [];
  // Keep the backend's provenance instead of relabeling future ideas as past outings.
  for (const item of suggestions) {
    const title = activityTitle(item.title);
    if (!title || seen.has(title.toLocaleLowerCase())) continue;
    seen.add(title.toLocaleLowerCase());
    ideas.push({ id: item.id, title, source: item.kind });
  }
  // Only outings worth repeating (a regular spot, or something you've done more than once); one-offs like a show are skipped.
  const visits = new Map<string, number>();
  for (const entry of entries) if (entry.kind === 'covered' && entry.event) {
    const key = entry.event.description.toLocaleLowerCase();
    visits.set(key, (visits.get(key) ?? 0) + 1);
  }
  for (const entry of [...entries].sort((a, b) => (b.event?.date ?? '').localeCompare(a.event?.date ?? ''))) {
    const event = entry.event;
    if (entry.kind !== 'covered' || !event?.attendees.some(person => person.personId === friendId)) continue;
    const title = activityTitle(event.description);
    if (!title || !(REPEATABLE.test(title) || (visits.get(event.description.toLocaleLowerCase()) ?? 0) > 1)) continue;
    const key = title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ideas.push({ id: event.id, title, source: 'history' });
  }
  return ideas.length ? ideas : [{ id: 'catch-up', title: 'Coffee and a catch-up', source: 'fallback' }];
}
