import { USER_ID, type FriendDetailResponse, type PaybackItem, type PaybackResponse, type PersonRef } from '@sark/shared';

export type SharedExperience = { id: string; title: string; date: string; friends: PersonRef[] };
export type NewExperience = { item: PaybackItem; friend: PersonRef };

export function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const titleKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const displayTitle = (title: string) => title.replace(/\s+purchase$/i, '').replace(/[$€£]\s*[\d,.]+/g, '').trim();

export function sharedExperiences(details: FriendDetailResponse[], asOf: string): SharedExperience[] {
  const events = new Map<string, SharedExperience>();
  for (const detail of details) {
    for (const entry of detail.entries) {
      const event = entry.event;
      if (!event || entry.kind === 'repayment' || event.date > asOf) continue;
      if (!event.attendees.some(person => person.personId === USER_ID)) continue;
      const participants = event.attendees.filter(person => person.personId !== USER_ID);
      if (!participants.some(person => person.personId === detail.friend.personId)) continue;
      const title = displayTitle(event.description);
      if (!title) continue;
      const existing = events.get(event.id);
      const people = new Map([...(existing?.friends ?? []), ...participants].map(person => [person.personId, person]));
      events.set(event.id, { id: event.id, title, date: event.date, friends: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)) });
    }
  }
  return [...events.values()].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

export function newExperience(responses: PaybackResponse[], history: SharedExperience[], asOf: string): NewExperience | null {
  const previous = new Set(history.map(event => titleKey(event.title)));
  const candidates = responses.flatMap(response => response.suggestions.flatMap(plan => plan.items)
    .filter(item => item.kind === 'discovered' && (!item.date || item.date >= asOf) && !previous.has(titleKey(displayTitle(item.title))))
    .map(item => ({ item, friend: response.friend })));
  candidates.sort((a, b) => (a.item.date ?? '9999').localeCompare(b.item.date ?? '9999') || a.item.id.localeCompare(b.item.id) || a.friend.personId.localeCompare(b.friend.personId));
  return candidates[0] ?? null;
}
