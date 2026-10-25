import { useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEventFeed } from '../api/event-hooks';
import { useEditEvent, useReview } from '../api/hooks';
import { EmptyState, ErrorState, Loading } from '../components/ui';
import { formatDate } from '../format';
import { AccountSheet } from './AccountSheet';
import { ReviewSheet } from './Review';
import { Action, Avatar, Header, Icon, NativeCanvas, Sheet, WarmSurface, palette } from './kit';
import { summarizeFriends } from './ledger-presentation';
import { memoryHook, sendInstead, shareFootnote, sourceUrl, yourTurnLabel } from './payback-presentation';
import type { SharedExperience } from './events-presentation';

const validDraft = (draft: { title: string; date: string; attendeeIds: string[] }) =>
  !!draft.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && !Number.isNaN(Date.parse(draft.date)) && draft.attendeeIds.length > 0;

function monthLabel(date: string) {
  const [year, month] = date.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function Events() {
  const feed = useEventFeed();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [account, setAccount] = useState(false);
  const [selected, setSelected] = useState<SharedExperience | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const reviews = useReview();
  const [reviewOpen, setReviewOpen] = useState(false);
  const edit = useEditEvent();
  const [draft, setDraft] = useState<{ title: string; date: string; attendeeIds: string[] } | null>(null);
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
        <Header onAccount={() => setAccount(true)} />
        <View style={s.heading}><Text style={s.title}>Events</Text><Text style={s.subtitle}>The things you do, and the people you share them with.</Text></View>
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
            <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.title}, ${formatDate(item.date)}, with ${item.friends.map(friend => friend.name).join(', ')}`} onPress={() => { setSelected(item); setDraft(null); edit.reset(); setDetailsOpen(true); }} style={({ pressed }) => [s.event, { opacity: pressed ? 0.75 : 1 }]}>
              <View style={s.dateTile}><Text style={s.day}>{Number(item.date.slice(8, 10))}</Text><Text style={s.dateMonth}>{new Date(`${item.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}><Text style={s.eventTitle}>{item.title}</Text><View style={s.participants}><View style={s.avatars}>{item.friends.slice(0, 3).map((friend, i) => <View key={friend.personId} style={{ marginLeft: i ? -6 : 0 }}><Avatar name={friend.name} size={23} /></View>)}</View><Text numberOfLines={2} style={s.friendNames}>{item.friends.map(friend => friend.name).join(', ')}</Text></View></View>
              <Icon name="chevron" size={18} color={palette.muted} />
            </Pressable>
          </View>}
        />}
    </NativeCanvas>
    <ReviewSheet visible={reviewOpen} onClose={() => setReviewOpen(false)} />
    <AccountSheet visible={account} onClose={() => setAccount(false)} owed={totals.owedCents} owe={totals.owingCents} available={feed.friends.isSuccess} failed={feed.friends.isError} onRetry={() => void feed.friends.refetch()} />
    <Sheet visible={detailsOpen} onClose={() => setDetailsOpen(false)} label="Shared experience">
      {current && !draft && <View style={{ gap: 17 }}>
        <View style={s.topLine}><Text style={s.eyebrow}>A SHARED MEMORY</Text></View>
        <Text style={s.detailTitle}>{current.title}</Text>
        <Text style={s.description}>{formatDate(current.date)}</Text>
        <Action title="Edit event" secondary onPress={() => { edit.reset(); setDraft({ title: current.title, date: current.date, attendeeIds: current.friends.map(friend => friend.personId) }); }} />
        <Text style={s.sectionTitle}>Together with</Text>
        {current.friends.map(friend => <Pressable accessibilityRole="button" accessibilityLabel={`View your balance with ${friend.name}`} key={friend.personId} onPress={() => { setDetailsOpen(false); router.push({ pathname: '/friends/[id]', params: { id: friend.personId } }); }} style={s.personRow}><Avatar name={friend.name} size={42} /><Text style={s.personName}>{friend.name}</Text><Icon name="chevron" size={20} color={palette.muted} /></Pressable>)}
        <Text style={s.source}>Tap a friend to see your balance with them.</Text>
      </View>}
      {current && draft && <View style={{ gap: 14 }}>
        <Text style={s.eyebrow}>EDIT EVENT</Text>
        <Text style={s.label}>What happened</Text>
        <TextInput accessibilityLabel="Event name" value={draft.title} onChangeText={title => setDraft({ ...draft, title })} style={s.input} />
        <Text style={s.label}>Date (YYYY-MM-DD)</Text>
        <TextInput accessibilityLabel="Event date" value={draft.date} onChangeText={date => setDraft({ ...draft, date })} style={s.input} autoCapitalize="none" />
        <Text style={s.label}>Who was there</Text>
        <View style={s.chips}>
          {(feed.friends.data ?? []).map(friend => {
            const on = draft.attendeeIds.includes(friend.personId);
            return <Pressable key={friend.personId} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setDraft({ ...draft, attendeeIds: on ? draft.attendeeIds.filter(id => id !== friend.personId) : [...draft.attendeeIds, friend.personId] })} style={[s.chip, on && s.chipOn]}>
              <Avatar name={friend.name} size={22} /><Text style={[s.chipText, on && { color: '#fff' }]}>{friend.name}</Text>
            </Pressable>;
          })}
        </View>
        {(edit.isError || !validDraft(draft)) && <Text accessibilityRole="alert" style={s.error}>{edit.isError ? 'Couldn’t save. Please try again.' : 'Add a name, a valid date and at least one friend.'}</Text>}
        <Action title={edit.isPending ? 'Saving…' : 'Save changes'} onPress={() => {
          if (!validDraft(draft) || edit.isPending) return;
          edit.mutate({ id: current.id, body: { description: draft.title.trim(), date: draft.date, attendeeIds: draft.attendeeIds } }, {
            onSuccess: () => { setSelected({ ...current, title: draft.title.trim(), date: draft.date, friends: (feed.friends.data ?? []).filter(friend => draft.attendeeIds.includes(friend.personId)).map(friend => ({ personId: friend.personId, name: friend.name })) }); setDraft(null); },
          });
        }} />
        <Action title="Cancel" secondary onPress={() => setDraft(null)} />
      </View>}
    </Sheet>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  heading: { paddingHorizontal: 24, paddingBottom: 23 },
  title: { fontFamily: 'Poppins', fontSize: 28, letterSpacing: -0.8, color: '#fff9f5' },
  subtitle: { fontFamily: 'Inter', fontSize: 12, lineHeight: 19, color: '#ffe5dc', marginTop: 5, maxWidth: 300 },
  lip: { height: 23, borderTopLeftRadius: 31, borderTopRightRadius: 31, backgroundColor: palette.bg },
  suggestion: { backgroundColor: '#f5e7df', borderWidth: 1, borderColor: '#ecd8cd', borderRadius: 25, padding: 20, gap: 13 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  eyebrow: { fontFamily: 'InterMedium', fontSize: 9, lineHeight: 15, letterSpacing: 1.1, color: '#a36d5e' },
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
  event: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, backgroundColor: '#fffdfb', borderWidth: 1, borderColor: '#eee3dc', marginBottom: 10 },
  dateTile: { width: 47, minHeight: 56, borderRadius: 15, backgroundColor: '#f7ece5', alignItems: 'center', justifyContent: 'center', gap: 2 },
  day: { fontFamily: 'Poppins', fontSize: 22, lineHeight: 29, color: '#a95748' },
  dateMonth: { fontFamily: 'InterMedium', fontSize: 9, letterSpacing: 0.7, color: '#b08978' },
  eventTitle: { fontFamily: 'Poppins', fontSize: 14, lineHeight: 21, color: palette.ink },
  participants: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 8 },
  avatars: { flexDirection: 'row' },
  friendNames: { flex: 1, fontFamily: 'Inter', fontSize: 10, lineHeight: 16, color: palette.muted },
  detailTitle: { fontFamily: 'Poppins', fontSize: 25, lineHeight: 34, letterSpacing: -0.6, color: palette.ink, paddingRight: 24 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fffdfb', padding: 12, borderRadius: 17, borderWidth: 1, borderColor: palette.line },
  personName: { flex: 1, fontFamily: 'Poppins', fontSize: 15, color: palette.ink },
  error: { fontFamily: 'Inter', fontSize: 11, lineHeight: 18, color: '#a54e45' },
  emptyTitle: { fontFamily: 'Poppins', fontSize: 19, lineHeight: 27, color: palette.ink },
  warning: { gap: 7, marginTop: 12 },
  review: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fffaf6', borderWidth: 1, borderColor: '#e8d4c9', borderRadius: 22, padding: 14, marginTop: 16 },
  reviewIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f4e4db', alignItems: 'center', justifyContent: 'center' },
  reviewTitle: { fontFamily: 'Poppins', fontSize: 15, lineHeight: 22, color: palette.ink },
  label: { fontFamily: 'InterMedium', fontSize: 11, color: palette.muted },
  input: { fontFamily: 'Inter', fontSize: 15, color: palette.ink, backgroundColor: '#fffdfb', borderWidth: 1, borderColor: palette.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: '#fffdfb' },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipText: { fontFamily: 'InterMedium', fontSize: 12, color: palette.ink },
  retry: { fontFamily: 'InterMedium', fontSize: 12, color: palette.accent },
});
