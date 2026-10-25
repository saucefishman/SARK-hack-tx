import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FriendSummary } from '@sark/shared';
import { useFriends, useReview } from '../api/hooks';
import { ErrorState, Loading } from '../components/ui';
import { AccountSheet } from './AccountSheet';
import { ReviewSheet } from './Review';
import { FriendSuggestion } from './FriendSuggestion';
import { Avatar, NativeCanvas, Header, Icon, Sheet, WarmSurface, palette } from './kit';
import { summarizeFriends } from './ledger-presentation';
import { exportLedger } from './export-ledger';

export default function Overview() {
  const router = useRouter();
  const query = useFriends();
  const reviews = useReview();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [friend, setFriend] = useState<FriendSummary | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const friends = query.data ?? [];
  const totals = summarizeFriends(friends);
  const shown = friends.filter(person => person.name.toLowerCase().includes(search.trim().toLowerCase()));
  const currentFriend = friends.find(person => person.personId === friend?.personId) ?? friend;
  async function download() {
    setExporting(true);
    try { await exportLedger(shown); }
    catch { Alert.alert('Export failed', 'Please try again.'); }
    finally { setExporting(false); }
  }
  if (query.isLoading) return <Loading label="Loading your people…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <View style={s.screen}>
    <NativeCanvas>
      <WarmSurface>
        <Header title="Even Stevens" onAccount={() => setAccount(true)} />
        <View style={s.lip} />
      </WarmSurface>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.scroll} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 115 + insets.bottom }} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => { void query.refetch(); void reviews.refetch(); }} tintColor={palette.accent} colors={[palette.accent]} progressBackgroundColor={palette.bg} />}>
        <View style={s.search}>
          <Icon name="search" size={22} color={palette.muted} />
          <TextInput accessibilityLabel="Search friends by name" placeholder="Find a friend" placeholderTextColor={palette.muted} value={search} onChangeText={setSearch} style={s.input} />
          {!!search && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')} hitSlop={10}><Icon name="close" size={18} color={palette.muted} /></Pressable>}
        </View>
        <View style={s.sectionHeading}>
          <Text style={s.sectionTitle}>Your people <Text style={s.friendCount}>{friends.length}</Text></Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Export shared activity" disabled={exporting || !shown.length} onPress={() => void download()} hitSlop={10} style={{ opacity: exporting || !shown.length ? 0.4 : 1 }}><Icon name="download" size={21} color={palette.muted} /></Pressable>
        </View>
        <View style={s.list}>
          {shown.map(item => <Pressable key={item.personId} accessibilityRole="button" accessibilityLabel={`View ${item.name}'s profile`} onPress={() => { setFriend(item); setDetailsOpen(true); }} style={({ pressed }) => [s.friend, { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
            <Avatar name={item.name} size={54} />
            <View style={{ flex: 1 }}><Text style={s.name}>{item.name}</Text><Text style={s.moments}>{item.eventCount} shared moments</Text></View>
            <View style={s.chevron}><Icon name="chevron" size={21} color={palette.accent} /></View>
          </Pressable>)}
        </View>
        {!shown.length && <View style={s.empty}><Text style={s.moments}>{friends.length ? 'No friends found. Try another name.' : 'Your shared moments will bring your people here.'}</Text></View>}
        <Pressable accessibilityRole="button" accessibilityLabel={`Review activity${reviews.data ? `, ${reviews.data.length} pending` : ''}`} onPress={() => setReviewOpen(true)} style={({ pressed }) => [s.review, { opacity: pressed ? 0.8 : 1 }]}>
          <View style={s.reviewIcon}><Icon name="review" size={23} color={palette.accent} /></View>
          <View style={{ flex: 1 }}><Text style={s.reviewTitle}>A little catch-up</Text><Text style={s.reviewCaption}>{reviews.isError ? 'Open to retry loading activity' : reviews.data?.length ? `${reviews.data.length} ${reviews.data.length === 1 ? 'detail needs' : 'details need'} a quick check` : reviews.isLoading ? 'Loading shared details…' : 'You’re all caught up'}</Text></View>
          <View style={s.chevron}><Icon name="chevron" size={20} color={palette.accent} /></View>
        </Pressable>
      </ScrollView>
    </NativeCanvas>
    <ReviewSheet visible={reviewOpen} onClose={() => setReviewOpen(false)} />
    <AccountSheet visible={account} onClose={() => setAccount(false)} owed={totals.owedCents} owe={totals.owingCents} available={query.isSuccess} failed={query.isError} onRetry={() => void query.refetch()} />
    <Sheet visible={detailsOpen} onClose={() => setDetailsOpen(false)} label={currentFriend ? `${currentFriend.name} details` : 'Friend details'}>
      {currentFriend && <FriendSuggestion key={currentFriend.personId} id={currentFriend.personId} name={currentFriend.name} onActivity={() => { setDetailsOpen(false); router.push({ pathname: '/friends/[id]', params: { id: currentFriend.personId } }); }} />}
    </Sheet>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  scroll: { flex: 1, backgroundColor: palette.bg },
  lip: { height: 24, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: palette.bg },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#efe6e0', borderRadius: 18, paddingHorizontal: 15, minHeight: 49 },
  input: { flex: 1, fontFamily: 'Inter', fontSize: 14, color: palette.ink, paddingVertical: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 25, marginBottom: 14 },
  sectionTitle: { fontFamily: 'Poppins', fontSize: 19, color: palette.ink, letterSpacing: -0.4 },
  friendCount: { fontFamily: 'Inter', fontSize: 13, color: palette.muted },
  list: { gap: 10 },
  friend: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fffdfb', borderWidth: 1, borderColor: '#eee3dc', borderRadius: 24, padding: 14 },
  name: { fontFamily: 'Poppins', fontSize: 18, lineHeight: 26, color: palette.ink },
  moments: { fontFamily: 'Inter', fontSize: 12, lineHeight: 19, color: palette.muted, marginTop: 3 },
  chevron: { width: 29, height: 29, borderRadius: 15, backgroundColor: '#f8eee8', alignItems: 'center', justifyContent: 'center' },
  review: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fffaf6', borderWidth: 1, borderColor: '#e8d4c9', borderRadius: 24, padding: 16, marginTop: 24 },
  reviewIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f4e4db', alignItems: 'center', justifyContent: 'center' },
  reviewTitle: { fontFamily: 'Poppins', fontSize: 15, lineHeight: 23, color: palette.ink },
  reviewCaption: { fontFamily: 'Inter', fontSize: 12, lineHeight: 19, color: '#9a8074', marginTop: 3 },
  empty: { paddingVertical: 25 },
});
