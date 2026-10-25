import type { FriendEntry } from '@sark/shared';

export type ActivityIdea = { id: string; title: string; fromHistory: boolean };

// Repeat an actual shared outing; don't rank people or ideas by money owed.
export function friendActivityIdeas(entries: FriendEntry[], friendId: string): ActivityIdea[] {
  const seen = new Set<string>();
  const ideas: ActivityIdea[] = [];
  for (const entry of [...entries].sort((a, b) => (b.event?.date ?? '').localeCompare(a.event?.date ?? ''))) {
    const event = entry.event;
    if (entry.kind !== 'covered' || !event?.attendees.some(person => person.personId === friendId)) continue;
    const title = event.description.replace(/\s+purchase$/i, '').trim();
    if (!title || /[$€£]|\b(payment|paid|repayments?|refunds?|transfers?|splits?|owes?|loans?|reimbursements?|settlement)\b/i.test(title)) continue;
    const key = title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ideas.push({ id: event.id, title, fromHistory: true });
  }
  return ideas.length ? ideas : [{ id: 'catch-up', title: 'Coffee and a catch-up', fromHistory: false }];
}
