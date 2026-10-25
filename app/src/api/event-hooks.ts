import { useQueries } from '@tanstack/react-query';
import { getFriend, getPayback } from './client';
import { useFriends } from './hooks';
import { localToday, newExperience, sharedExperiences, upcomingTurns } from '../native/events-presentation';

export function useEventFeed() {
  const friends = useFriends();
  const history = useQueries({ queries: (friends.data ?? []).map(friend => ({ queryKey: ['friend', friend.personId], queryFn: () => getFriend(friend.personId) })) });
  const suggestions = useQueries({ queries: (friends.data ?? []).map(friend => ({ queryKey: ['payback', friend.personId], queryFn: () => getPayback(friend.personId) })) });
  const today = localToday();
  const details = history.flatMap(query => query.data ? [query.data] : []);
  const events = sharedExperiences(details, today);
  const paybacks = suggestions.flatMap(query => query.data ? [query.data] : []);
  const suggestion = newExperience(paybacks, events, today);
  const turns = upcomingTurns(paybacks, today);
  return {
    friends, details, events, suggestion, turns,
    loadingHistory: friends.isPending || history.some(query => query.isPending),
    historyError: history.find(query => query.isError)?.error,
    loadingSuggestion: friends.isPending || suggestions.some(query => query.isPending),
    suggestionError: suggestions.find(query => query.isError)?.error,
    refreshing: friends.isRefetching || [...history, ...suggestions].some(query => query.isRefetching),
    refresh: async () => { await Promise.all([friends.refetch(), ...history.map(query => query.refetch()), ...suggestions.map(query => query.refetch())]); },
  };
}
