import { useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEventFeed } from '../api/event-hooks';
import { useReview } from '../api/hooks';
import { EmptyState, ErrorState, Loading } from '../components/ui';
import { formatDate } from '../format';
import { AccountSheet } from './AccountSheet';
import { EventRow, EventSheet, monthLabel } from './EventCard';
import { ReviewSheet } from './Review';
import { Action, Avatar, Header, Icon, NativeCanvas, WarmSurface, palette } from './kit';
import { summarizeFriends } from './ledger-presentation';
import { memoryHook, sendInstead, shareFootnote, sourceUrl, yourTurnLabel } from './payback-presentation';
import type { SharedExperience } from './events-presentation';

export default function Events() {
  const feed = useEventFeed();
  const insets = useSafeAreaInsets();
  const [account, setAccount] = useState(false);
  const [selected, setSelected] = useState<SharedExperience | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const reviews = useReview();
  const [reviewOpen, setReviewOpen] = useState(false);
  const pending = reviews.data?.length ?? 0;
  const totals = summarizeFriends(feed.friends.data ?? []);
  const current = feed.events.find(event => event.id === selected?.id) ?? selected;
  const suggestion = feed.suggestion;
  const url = sourceUrl(suggestion?.item.url ?? null);
  const memory = suggestion ? memoryHook(feed.details.find(detail => detail.friend.personId === suggestion.friend.personId)?.entries ?? [], suggestion.friend.name) : null;
  async function openEvent() {
    if (!url) return;
    setLinkError(false);
    try { await Linking.openURL(url); } catch { setLinkError(true); }
  }
  return <View style={s.screen}>
    <NativeCanvas>
      <WarmSurface>
        <Header title="Events" onAccount={() => setAccount(true)} />
        <View style={s.lip} />
      </WarmSurface>
      {feed.friends.isError ? <ErrorState error={feed.friends.error} onRetry={() => void feed.refresh()} /> :
        <FlatList
          data={feed.loadingHistory ? [] : feed.events}
          keyExtractor={event => event.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 115 + insets.bottom }}
          refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => void feed.refresh()} tintColor={palette.accent} colors={[palette.accent]} />}
          ListHeaderComponent={<View>
            <View style={s.suggestion}>
              <View style={s.topLine}><Text style={s.turn}>{suggestion ? yourTurnLabel(suggestion.friend.name) : 'Your turn'}</Text><Icon name="events" size={20} color={palette.accent} /></View>
              {feed.loadingSuggestion || feed.loadingHistory ? <View style={{ minHeight: 90 }}><Loading label="Finding a new experience…" /></View> : suggestion ? <>
                {!!memory && <Text style={s.memory}>{memory}</Text>}
                <Text style={s.suggestionTitle}>{suggestion.item.title}</Text>
                <View style={s.suggestionPerson}><Avatar name={suggestion.friend.name} size={25} /><Text style={s.suggestionMeta}>Treat {suggestion.friend.name}{suggestion.item.date ? ` · ${formatDate(suggestion.item.date)}` : ''}</Text></View>
                <Text style={s.source}>{shareFootnote(suggestion.item, suggestion.debtCents, suggestion.toleranceCents)}</Text>
                {url && <Action title={`Plan it with ${suggestion.friend.name}`} onPress={() => void openEvent()} />}
                {linkError && <Text accessibilityRole="alert" style={s.error}>Couldn’t open the event. Please try again.</Text>}
                <Text style={s.source}>{sendInstead(suggestion.debtCents)}</Text>
              </> : <>
                <Text style={s.emptyTitle}>{feed.suggestionError ? 'Couldn’t load a new idea' : 'Nothing planned yet'}</Text>
                <Text style={s.description}>{feed.suggestionError ? 'Your shared experiences are still below. Try loading suggestions again.' : 'When a friend covers you, we’ll find something fun you can treat them to next.'}</Text>
                <Action title="Reload suggestions" secondary onPress={() => void feed.refresh()} />
              </>}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Check event details${pending ? `, ${pending} pending` : ''}`} onPress={() => setReviewOpen(true)} style={({ pressed }) => [s.review, { opacity: pressed ? 0.8 : 1 }]}>
              <View style={s.reviewIcon}><Icon name="review" size={22} color={palette.accent} /></View>
              <View style={{ flex: 1 }}><Text style={s.reviewTitle}>A little catch-up</Text><Text style={s.description}>{reviews.isError ? 'Open to retry loading details' : pending ? `${pending} ${pending === 1 ? 'event needs' : 'events need'} a quick check` : reviews.isLoading ? 'Loading event details…' : 'You’re all caught up'}</Text></View>
              <Icon name="chevron" size={20} color={palette.accent} />
            </Pressable>
            <View style={s.sectionHeading}><Text style={s.sectionTitle}>Your shared experiences</Text>{!feed.loadingHistory && <Text style={s.count}>{feed.events.length}</Text>}</View>
            {!!feed.historyError && <View style={s.warning}><Text style={s.description}>Some shared activity couldn’t load. This list may be incomplete.</Text><Pressable accessibilityRole="button" onPress={() => void feed.refresh()}><Text style={s.retry}>Try again</Text></Pressable></View>}
          </View>}
          ListEmptyComponent={feed.loadingHistory ? <View style={{ minHeight: 180 }}><Loading label="Gathering your shared experiences…" /></View> : <EmptyState title="Your memories start here" body="Shared experiences with your friends will appear here." />}
          renderItem={({ item, index }) => <View>
            {(index === 0 || feed.events[index - 1].date.slice(0, 7) !== item.date.slice(0, 7)) && <Text style={s.month}>{monthLabel(item.date)}</Text>}
            <EventRow event={item} onPress={() => { setSelected(item); setDetailsOpen(true); }} />
          </View>}
        />}
    </NativeCanvas>
    <ReviewSheet visible={reviewOpen} onClose={() => setReviewOpen(false)} />
    <AccountSheet visible={account} onClose={() => setAccount(false)} owed={totals.owedCents} owe={totals.owingCents} available={feed.friends.isSuccess} failed={feed.friends.isError} onRetry={() => void feed.friends.refetch()} />
    <EventSheet event={current} visible={detailsOpen} onClose={() => setDetailsOpen(false)} />
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  lip: { height: 23, borderTopLeftRadius: 31, borderTopRightRadius: 31, backgroundColor: palette.bg },
  suggestion: { backgroundColor: '#f5e7df', borderWidth: 1, borderColor: '#ecd8cd', borderRadius: 25, padding: 20, gap: 13 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  suggestionTitle: { fontFamily: 'Poppins', fontSize: 23, lineHeight: 31, letterSpacing: -0.6, color: '#623d33' },
  suggestionPerson: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  turn: { flex: 1, fontFamily: 'Poppins', fontSize: 17, lineHeight: 24, letterSpacing: -0.3, color: '#a95748' },
  memory: { fontFamily: 'Inter', fontSize: 12, lineHeight: 19, color: '#986f60' },
  suggestionMeta: { flex: 1, fontFamily: 'InterMedium', fontSize: 11, lineHeight: 18, color: '#986f60' },
  description: { fontFamily: 'Inter', fontSize: 12, lineHeight: 20, color: '#987a6c' },
  source: { fontFamily: 'Inter', fontSize: 10, lineHeight: 17, color: '#a48a7e' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 28, marginBottom: 4 },
  sectionTitle: { fontFamily: 'Poppins', fontSize: 18, letterSpacing: -0.5, color: palette.ink },
  count: { fontFamily: 'Inter', fontSize: 12, color: palette.muted },
  month: { fontFamily: 'InterMedium', fontSize: 11, color: palette.muted, marginTop: 18, marginBottom: 12 },
  error: { fontFamily: 'Inter', fontSize: 11, lineHeight: 18, color: '#a54e45' },
  emptyTitle: { fontFamily: 'Poppins', fontSize: 19, lineHeight: 27, color: palette.ink },
  warning: { gap: 7, marginTop: 12 },
  review: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fffaf6', borderWidth: 1, borderColor: '#e8d4c9', borderRadius: 22, padding: 14, marginTop: 16 },
  reviewIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f4e4db', alignItems: 'center', justifyContent: 'center' },
  reviewTitle: { fontFamily: 'Poppins', fontSize: 15, lineHeight: 22, color: palette.ink },
  retry: { fontFamily: 'InterMedium', fontSize: 12, color: palette.accent },
});
