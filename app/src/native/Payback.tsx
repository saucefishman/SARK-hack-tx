import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PaybackSuggestion } from '@sark/shared';
import { useDismissPayback, useFriends, usePayback } from '../api/hooks';
import { EmptyState, ErrorState, Loading } from '../components/ui';
import { formatCents, formatDate } from '../format';
import { AccountSheet } from './AccountSheet';
import { Action, Avatar, Blue, Header, Icon, NativeCanvas, Sheet, palette } from './kit';
import { summarizeFriends } from './ledger-presentation';
import { priceRange, remainingBalance, sourceUrl } from './payback-presentation';

const kindLabels = { planned: 'On your calendar', recurring: 'A familiar favorite', discovered: 'Something to try' };

function FriendPlans({ id }: { id: string }) {
  const query = usePayback(id);
  const dismiss = useDismissPayback(id);
  const [plan, setPlan] = useState<PaybackSuggestion | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const data = query.data;
  const [notice, setNotice] = useState('');
  async function remove(item: PaybackSuggestion) {
    setNotice('');
    try {
      await dismiss.mutateAsync(item.id);
      setPlanOpen(false);
      setNotice('Plan dismissed. Your balance is unchanged.');
    } catch { /* Keep the plan and show the mutation error below. */ }
  }
  async function openSource(url: string) {
    setLinkError(false);
    try { await Linking.openURL(url); } catch { setLinkError(true); }
  }
  if (query.isLoading) return <Loading label="Finding your payback ideas…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!data) return null;
  return <View style={{ gap: 14 }}>
    <View style={s.balanceCard}>
      <View style={s.balancePerson}>
        <Avatar name={data.friend.name} size={46} />
        <View style={{ flex: 1 }}>
          <Text style={s.balanceName}>{data.friend.name}</Text>
          <Text style={s.balanceLabel}>You owe</Text>
        </View>
      </View>
      <Text style={s.debt} adjustsFontSizeToFit numberOfLines={1}>{formatCents(data.debtCents)}</Text>
    </View>
    <View style={s.sectionHeading}>
      <Text style={s.sectionTitle}>Make the next one yours</Text>
      <Text style={s.counter}>{data.suggestions.length} ideas</Text>
    </View>
    <Text style={s.body}>Pick up {data.friend.name}’s share of a future outing. These are ideas, so your balance stays the same until an expense is recorded.</Text>
    {!!notice && <Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text>}
    {dismiss.isError && <Text accessibilityRole="alert" style={s.error}>Couldn't dismiss this plan. Please try again.</Text>}
    {data.suggestions.map((item, index) => <View style={s.plan} key={item.id}>
      <View style={s.row}>
        <Text style={s.tag}>{item.kind === 'exact' ? 'Close match' : 'Part of the way'}</Text>
        <Text style={s.planNumber}>0{index + 1}</Text>
      </View>
      <Text style={s.planAmount}>{priceRange(item.totalLowCents, item.totalHighCents)}</Text>
      <Text style={s.caption}>{data.friend.name}’s share · {remainingBalance(item, data.debtCents)}</Text>
      <View style={s.items}>
        {item.items.map((outing, i) => <View style={s.item} key={outing.id}>
          <View style={s.step}><Text style={s.stepText}>{i + 1}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.itemTitle}>{outing.title}</Text>
            <Text style={s.caption}>{outing.date ? formatDate(outing.date) : 'Date to be decided'} · {kindLabels[outing.kind]}</Text>
          </View>
        </View>)}
      </View>
      <Action title="View plan" onPress={() => { setPlan(item); setPlanOpen(true); setLinkError(false); dismiss.reset(); }} />
    </View>)}
    {!data.suggestions.length && <View style={s.plan}><EmptyState title={data.debtCents ? 'No ideas just yet' : 'All balanced'} body={data.debtCents ? 'There are no available plans for this friend right now.' : 'You don’t owe this friend anything.'} /></View>}
    {data.needsTransfer && data.debtCents > 0 && <Text style={s.footnote}>The available ideas don’t cover your full balance. You can arrange the rest directly with {data.friend.name}.</Text>}
    <Sheet visible={planOpen} onClose={() => { if (!dismiss.isPending) setPlanOpen(false); }} label="Payback plan">
      {plan && <View style={{ gap: 14 }}>
        <Text style={s.sheetEyebrow}>A PLAN WITH {data.friend.name.toUpperCase()}</Text>
        <Text style={s.sheetTitle}>Your next one, covered.</Text>
        <View style={s.summary}>
          <Text style={s.caption}>{data.friend.name}’s total share</Text>
          <Text style={s.planAmount}>{priceRange(plan.totalLowCents, plan.totalHighCents)}</Text>
          <Text style={s.body}>{remainingBalance(plan, data.debtCents)}</Text>
        </View>
        {plan.items.map(item => {
          const url = sourceUrl(item.url);
          return <View key={item.id} style={s.detail}>
            <Text style={s.sheetEyebrow}>{kindLabels[item.kind].toUpperCase()}</Text>
            <Text style={s.detailTitle}>{item.title}</Text>
            <Text style={s.body}>{item.date ? formatDate(item.date) : 'Date to be decided'}</Text>
            <View style={[s.row, { marginVertical: 10 }]}>
              <Text style={s.share}>{priceRange(item.friendShareLowCents, item.friendShareHighCents)}</Text>
              <Text style={s.caption}>{item.basis === 'estimated' ? 'Estimated share' : 'Confirmed share'}</Text>
            </View>
            <Text style={s.evidence}>{item.evidence}</Text>
            {url && <Pressable accessibilityRole="link" accessibilityLabel={`Open source for ${item.title}`} onPress={() => void openSource(url)} style={s.source}><Text style={s.sourceText}>View source</Text><Icon name="arrow" size={16} color={palette.blue} /></Pressable>}
          </View>;
        })}
        <Text style={s.footnote}>Prices are {data.friend.name}’s share, not the entire bill. Estimates may change. Viewing a plan doesn’t book an outing or send money.</Text>
        {linkError && <Text accessibilityRole="alert" style={s.error}>Couldn't open the source. Please try again.</Text>}
        {dismiss.isError && <Text accessibilityRole="alert" style={s.error}>Couldn't dismiss this plan. Please try again.</Text>}
        <Action title={dismiss.isPending ? 'Dismissing…' : 'Dismiss this plan'} secondary disabled={dismiss.isPending} onPress={() => void remove(plan)} />
      </View>}
    </Sheet>
  </View>;
}

export default function Payback() {
  const friends = useFriends();
  const [selected, setSelected] = useState<string | null>(null);
  const [account, setAccount] = useState(false);
  const insets = useSafeAreaInsets();
  const debtors = (friends.data ?? []).filter(friend => friend.balanceCents < 0);
  const current = debtors.find(friend => friend.personId === selected) ?? debtors[0];
  const payback = usePayback(current?.personId ?? '');
  const totals = summarizeFriends(friends.data ?? []);
  return <View style={s.screen}>
    <NativeCanvas>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} refreshControl={<RefreshControl refreshing={friends.isRefetching || payback.isRefetching} onRefresh={() => { void friends.refetch(); if (current) void payback.refetch(); }} tintColor="#fff" />}>
        <Blue>
          <Header onAccount={() => setAccount(true)} />
          <View style={s.heading}>
            <Text style={s.title}>Pay them back.</Text>
            <Text style={s.subtitle}>Good company. A little more balance.</Text>
          </View>
          <View style={s.lip} />
        </Blue>
        <View style={s.content}>
          {friends.isLoading ? <Loading label="Loading your circle…" /> : friends.isError ? <ErrorState error={friends.error} onRetry={() => void friends.refetch()} /> : !current ? <View style={s.plan}><EmptyState title="You're all balanced" body="When you owe a friend, their payback ideas will appear here." /></View> : <>
            {debtors.length > 1 && <View style={{ gap: 10 }}>
            <Text style={s.balanceLabel}>Choose a friend</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {debtors.map(friend => <Pressable key={friend.personId} accessibilityRole="button" accessibilityState={{ selected: current.personId === friend.personId }} onPress={() => setSelected(friend.personId)} style={[s.friend, current.personId === friend.personId && s.friendOn]}><Avatar name={friend.name} size={26} /><Text style={s.friendName}>{friend.name}</Text></Pressable>)}
            </ScrollView>
            </View>}
            <FriendPlans key={current.personId} id={current.personId} />
          </>}
        </View>
      </ScrollView>
    </NativeCanvas>
    <AccountSheet visible={account} onClose={() => setAccount(false)} owed={totals.owedCents} owe={totals.owingCents} available={friends.isSuccess} failed={friends.isError} onRetry={() => void friends.refetch()} />
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  heading: { paddingHorizontal: 24, paddingBottom: 28 },
  title: { fontFamily: 'Poppins', fontSize: 30, letterSpacing: -1, color: '#fff' },
  subtitle: { fontFamily: 'Inter', fontSize: 12, color: '#dfebff', marginTop: 5 },
  lip: { height: 22, borderTopLeftRadius: 31, borderTopRightRadius: 31, backgroundColor: palette.bg },
  content: { paddingHorizontal: 20, gap: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  friend: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 25, borderWidth: 1, borderColor: '#e2eaf6', backgroundColor: '#ffffffb3', paddingVertical: 8, paddingHorizontal: 12 },
  friendOn: { borderColor: '#b6cff2', backgroundColor: '#e4eeff' },
  friendName: { fontFamily: 'Poppins', fontSize: 12, color: '#3865a7' },
  balanceCard: { backgroundColor: '#fff', borderRadius: 25, padding: 22, borderWidth: 1, borderColor: '#dfe8f7' },
  balancePerson: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  balanceName: { fontFamily: 'Poppins', fontSize: 18, lineHeight: 26, color: palette.ink },
  balanceLabel: { fontFamily: 'Inter', fontSize: 12, lineHeight: 19, color: '#7b8fa9' },
  debt: { fontFamily: 'InterSemiBold', fontSize: 42, lineHeight: 52, letterSpacing: -1.8, color: '#2d65b7', marginTop: 17 },
  caption: { fontFamily: 'Inter', fontSize: 10, lineHeight: 17, color: '#8395ae' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 7 },
  sectionTitle: { flex: 1, fontFamily: 'Poppins', fontSize: 17, letterSpacing: -0.5, color: palette.ink },
  counter: { fontFamily: 'InterMedium', fontSize: 10, color: '#8196b3' },
  body: { fontFamily: 'Inter', fontSize: 11, lineHeight: 18, color: '#7b8fa9' },
  plan: { padding: 18, backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#e7edf7' },
  tag: { fontFamily: 'InterMedium', fontSize: 9, color: '#5481bd', backgroundColor: '#edf4ff', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12 },
  planNumber: { fontFamily: 'Inter', fontSize: 11, color: '#bac9dc' },
  planAmount: { fontFamily: 'InterSemiBold', fontSize: 28, letterSpacing: -1.1, color: '#233954', marginTop: 12, marginBottom: 3 },
  items: { marginVertical: 17, gap: 14 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  step: { width: 27, height: 27, borderRadius: 10, backgroundColor: '#f0f5fd', alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: 'InterMedium', fontSize: 10, color: '#7393be' },
  itemTitle: { fontFamily: 'Poppins', fontSize: 12, lineHeight: 19, color: '#364e6f' },
  footnote: { fontFamily: 'Inter', fontSize: 10, lineHeight: 17, color: '#8b9db4' },
  notice: { fontFamily: 'Inter', fontSize: 11, lineHeight: 18, color: '#3b76bd' },
  error: { fontFamily: 'Inter', fontSize: 11, color: '#a35151', lineHeight: 18 },
  sheetEyebrow: { fontFamily: 'InterMedium', fontSize: 9, letterSpacing: 1, color: '#7b97bc' },
  sheetTitle: { fontFamily: 'Poppins', fontSize: 25, letterSpacing: -0.7, color: palette.ink },
  summary: { borderRadius: 19, backgroundColor: '#e7effc', padding: 17 },
  detail: { padding: 17, backgroundColor: '#fff', borderRadius: 19, borderWidth: 1, borderColor: palette.line },
  detailTitle: { fontFamily: 'Poppins', fontSize: 16, lineHeight: 23, color: '#2d4668', marginTop: 9, marginBottom: 4 },
  share: { fontFamily: 'InterSemiBold', fontSize: 18, color: '#3865a7' },
  evidence: { fontFamily: 'Inter', fontSize: 10, lineHeight: 18, color: '#8496af' },
  source: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingVertical: 12 },
  sourceText: { fontFamily: 'InterMedium', fontSize: 11, color: palette.blue },
});
