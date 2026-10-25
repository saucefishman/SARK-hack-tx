import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEventFeed } from '../api/event-hooks';
import { useReview } from '../api/hooks';
import { ErrorState, Loading } from '../components/ui';
import { formatCents, formatDate } from '../format';
import { AccountSheet } from './AccountSheet';
import { Action, Avatar, Header, Icon, NativeCanvas, WarmSurface, palette } from './kit';
import { Constellation } from './Constellation';
import { summarizeFriends } from './ledger-presentation';
import { memoryHook, shareFootnote } from './payback-presentation';

const steps = [
  'We read your messages, calendar and card activity to see who covered whom.',
  'When a friend covers you, it’s your turn.',
  'We find plans you can treat them to, so you even out with time together instead of a payment request.',
];

function greeting(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Good night';
}

// Front screen: what the app is for, then the next few "your turn" plans across every friend the user owes.
export default function Home() {
  const feed = useEventFeed();
  const reviews = useReview();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [account, setAccount] = useState(false);
  const totals = summarizeFriends(feed.friends.data ?? []);
  const pending = reviews.data?.length ?? 0;
  const openFriend = (id: string) => router.push({ pathname: '/friends/[id]', params: { id } });
  return <View style={s.screen}>
    <NativeCanvas>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 115 + insets.bottom }} refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => { void feed.refresh(); void reviews.refetch(); }} tintColor={palette.accent} colors={[palette.accent]} />}>
        <WarmSurface>
          <Header title={greeting()} onAccount={() => setAccount(true)} />
          <View style={s.hero}>
            {feed.friends.isSuccess && <View style={s.stats}>
              <View><Text style={s.statLabel}>Your turn to cover</Text><Text style={s.statValue}>{formatCents(totals.owingCents)}</Text></View>
            </View>}
          </View>
          <View style={s.lip} />
        </WarmSurface>
        <View style={s.body}>
          {feed.friends.isSuccess && (feed.friends.data?.length ?? 0) > 0 && <View style={s.circle}>
            <Text style={s.sectionTitle}>Your circle</Text>
            <Text style={s.caption}>Who’s covered whom. Tap a friend.</Text>
            <View style={s.starCard}><Constellation friends={feed.friends.data ?? []} onSelect={openFriend} /></View>
            <Action title="See detailed summary" secondary onPress={() => router.push('/people')} />
          </View>}
          <Text style={s.sectionTitle}>Your turn</Text>
          <Text style={s.caption}>Upcoming plans that pay a friend back.</Text>
          {feed.friends.isError ? <ErrorState error={feed.friends.error} onRetry={() => void feed.refresh()} /> :
            feed.loadingSuggestion || feed.loadingHistory ? <View style={{ minHeight: 120 }}><Loading label="Finding your next plans…" /></View> :
            feed.turns.length ? <View style={s.list}>
              {feed.turns.map((turn, index) => {
                // The "why" line once per friend; later cards for the same friend skip it.
                const memory = feed.turns.findIndex(other => other.friend.personId === turn.friend.personId) === index && memoryHook(feed.details.find(detail => detail.friend.personId === turn.friend.personId)?.entries ?? [], turn.friend.name);
                return <Pressable key={`${turn.friend.personId}:${turn.item.id}`} accessibilityRole="button" accessibilityLabel={`${turn.item.title} with ${turn.friend.name}, ${formatDate(turn.item.date!)}`} onPress={() => openFriend(turn.friend.personId)} style={({ pressed }) => [s.turn, { opacity: pressed ? 0.85 : 1 }]}>
                  <View style={s.turnTop}><Avatar name={turn.friend.name} size={30} /><Text style={s.turnWith}>Your turn with {turn.friend.name}</Text><Text style={s.turnDate}>{formatDate(turn.item.date!)}</Text></View>
                  <Text style={s.turnTitle}>{turn.item.title}</Text>
                  {!!memory && <Text style={s.memory}>{memory}</Text>}
                  <Text style={s.footnote}>{shareFootnote(turn.item, turn.debtCents, turn.toleranceCents)}</Text>
                </Pressable>;
              })}
            </View> : <View style={s.empty}><Text style={s.emptyTitle}>You’re even with everyone</Text><Text style={s.caption}>When a friend covers you, plans to treat them will show up here.</Text></View>}
          {pending > 0 && <Pressable accessibilityRole="button" onPress={() => router.push('/events')} style={({ pressed }) => [s.check, { opacity: pressed ? 0.8 : 1 }]}>
            <Icon name="review" size={22} color={palette.accent} />
            <Text style={s.checkText}>{pending} {pending === 1 ? 'detail needs' : 'details need'} a quick check</Text>
            <Icon name="chevron" size={20} color={palette.accent} />
          </Pressable>}
          <Text style={[s.sectionTitle, { marginTop: 30 }]}>How it works</Text>
          <View style={s.steps}>
            {steps.map((step, i) => <View key={step} style={s.step}><Text style={s.stepNumber}>{i + 1}</Text><Text style={s.stepText}>{step}</Text></View>)}
          </View>
        </View>
      </ScrollView>
    </NativeCanvas>
    <AccountSheet visible={account} onClose={() => setAccount(false)} owed={totals.owedCents} owe={totals.owingCents} available={feed.friends.isSuccess} failed={feed.friends.isError} onRetry={() => void feed.friends.refetch()} />
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  hero: { paddingHorizontal: 24, paddingBottom: 26 },
  stats: { flexDirection: 'row', gap: 28, marginTop: 4 },
  statLabel: { fontFamily: 'Inter', fontSize: 10, color: '#ffffffad' },
  statValue: { fontFamily: 'InterMedium', fontSize: 18, color: '#fff', marginTop: 4 },
  lip: { height: 23, borderTopLeftRadius: 31, borderTopRightRadius: 31, backgroundColor: palette.bg },
  body: { paddingHorizontal: 20 },
  circle: { marginBottom: 28 },
  starCard: { marginTop: 12, marginBottom: 14, paddingVertical: 14, borderRadius: 24, backgroundColor: '#fffdfb', borderWidth: 1, borderColor: '#eee3dc' },
  sectionTitle: { fontFamily: 'Poppins', fontSize: 20, letterSpacing: -0.5, color: palette.ink },
  caption: { fontFamily: 'Inter', fontSize: 12, lineHeight: 19, color: palette.muted, marginTop: 3 },
  list: { gap: 12, marginTop: 14 },
  turn: { backgroundColor: '#f5e7df', borderWidth: 1, borderColor: '#ecd8cd', borderRadius: 24, padding: 18, gap: 8 },
  turnTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  turnWith: { flex: 1, fontFamily: 'Poppins', fontSize: 15, color: '#a95748' },
  turnDate: { fontFamily: 'InterMedium', fontSize: 11, color: '#986f60' },
  turnTitle: { fontFamily: 'Poppins', fontSize: 20, lineHeight: 27, letterSpacing: -0.4, color: '#623d33' },
  memory: { fontFamily: 'Inter', fontSize: 12, lineHeight: 19, color: '#986f60' },
  footnote: { fontFamily: 'Inter', fontSize: 10, lineHeight: 17, color: '#a48a7e' },
  empty: { marginTop: 14, padding: 18, borderRadius: 22, backgroundColor: '#fffdfb', borderWidth: 1, borderColor: palette.line },
  emptyTitle: { fontFamily: 'Poppins', fontSize: 16, color: palette.ink },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, padding: 15, borderRadius: 20, backgroundColor: '#fffaf6', borderWidth: 1, borderColor: '#e8d4c9' },
  checkText: { flex: 1, fontFamily: 'InterMedium', fontSize: 13, color: palette.ink },
  steps: { gap: 12, marginTop: 12 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNumber: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#f4e4db', textAlign: 'center', lineHeight: 26, fontFamily: 'InterSemiBold', fontSize: 12, color: palette.accent, overflow: 'hidden' },
  stepText: { flex: 1, fontFamily: 'Inter', fontSize: 13, lineHeight: 20, color: palette.ink },
});
