import type { FriendSummary, ReviewAnswerBody, ReviewItemDto } from '@sark/shared';

/** All totals use the API's integer cents; assumed/possible amounts stay separate. */
export function summarizeFriends(friends: FriendSummary[]) {
  return friends.reduce((totals, friend) => ({
    owedCents: totals.owedCents + Math.max(0, friend.balanceCents),
    owingCents: totals.owingCents + Math.max(0, -friend.balanceCents),
    sharedBalanceCents: totals.sharedBalanceCents + friend.balanceCents,
    spentCents: totals.spentCents + friend.youSpentOnThemCents,
    receivedCents: totals.receivedCents + friend.spentOnYouCents,
    possibleCents: totals.possibleCents + friend.possibleCents,
  }), { owedCents: 0, owingCents: 0, sharedBalanceCents: 0, spentCents: 0, receivedCents: 0, possibleCents: 0 });
}

export function filterFriends(friends: FriendSummary[], filter: number, search: string) {
  const query = search.trim().toLowerCase();
  return friends.filter(friend => friend.name.toLowerCase().includes(query) && (
    filter === 0 || filter === 1 && friend.balanceCents > 0 || filter === 2 && friend.balanceCents < 0 || filter === 3 && friend.balanceCents === 0
  ));
}

/** These keys deliberately match the current ReviewAnswerBody contract, including alias -> payerId. */
export function reviewAnswer(item: ReviewItemDto, selected: string[]): ReviewAnswerBody {
  const ids = [...new Set(selected)];
  const allowed = new Set(item.options?.map(person => person.personId));
  if (!ids.length || ids.some(id => !allowed.has(id))) throw new Error('Choose a listed person.');
  if (item.kind === 'attendees') return { personIds: ids };
  if (ids.length !== 1) throw new Error('Choose one person.');
  return { payerId: ids[0] };
}

export function ledgerCsv(friends: FriendSummary[]) {
  const cell = (value: string | number) => '"' + String(typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value).replace(/"/g, '""') + '"';
  return [['Name', 'Shared moments', 'You spent (USD)', 'Spent on you (USD)', 'Balance (USD)'], ...friends.map(friend => [friend.name, friend.eventCount, friend.youSpentOnThemCents / 100, friend.spentOnYouCents / 100, friend.balanceCents / 100])].map(row => row.map(cell).join(',')).join('\r\n');
}
