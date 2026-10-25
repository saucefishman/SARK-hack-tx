import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFriends } from '../api/hooks';
import { ErrorState, Loading } from '../components/ui';
import { AccountSheet } from './AccountSheet';
import { formatCents } from '../format';
import { Avatar, NativeCanvas, Header, Icon, WarmSurface, palette } from './kit';
import { summarizeFriends } from './ledger-presentation';
import { exportLedger } from './export-ledger';

export default function Overview() {
  const router = useRouter();
  const query = useFriends();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState(false);
  const [exporting, setExporting] = useState(false);
  const friends = query.data ?? [];
  const totals = summarizeFriends(friends);
  const shown = friends.filter(person => person.name.toLowerCase().includes(search.trim().toLowerCase()));
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
        <Header title="Friends" onAccount={() => setAccount(true)} />
        <View style={s.lip} />
      </WarmSurface>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.scroll} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 115 + insets.bottom }} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.accent} colors={[palette.accent]} progressBackgroundColor={palette.bg} />}>
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
          {shown.map(item => <Pressable key={item.personId} accessibilityRole="button" accessibilityLabel={`View your balance with ${item.name}`} onPress={() => router.push({ pathname: '/friends/[id]', params: { id: item.personId } })} style={({ pressed }) => [s.friend, { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
            <Avatar name={item.name} size={54} />
            <View style={{ flex: 1, minWidth: 0 }}><Text style={s.name}>{item.name}</Text><Text style={s.moments}>{item.eventCount} shared moments</Text></View>
            {/* Two short lines instead of one long one, so a narrow phone never truncates it or squeezes the name. */}
            <View style={s.turnBox}>
              <Text style={[s.balance, item.balanceCents < 0 && { color: palette.accent }]}>{item.balanceCents < 0 ? 'Your turn' : item.balanceCents > 0 ? 'Their turn' : 'Even'}</Text>
              {item.balanceCents !== 0 && <Text style={[s.turnAmount, item.balanceCents < 0 && { color: palette.accent }]}>{formatCents(Math.abs(item.balanceCents))}</Text>}
            </View>
            <View style={s.chevron}><Icon name="chevron" size={21} color={palette.accent} /></View>
          </Pressable>)}
        </View>
        {!shown.length && <View style={s.empty}><Text style={s.moments}>{friends.length ? 'No friends found. Try another name.' : 'Your shared moments will bring your people here.'}</Text></View>}
      </ScrollView>
    </NativeCanvas>
    <AccountSheet visible={account} onClose={() => setAccount(false)} owed={totals.owedCents} owe={totals.owingCents} available={query.isSuccess} failed={query.isError} onRetry={() => void query.refetch()} />
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
  empty: { paddingVertical: 25 },
  turnBox: { alignItems: 'flex-end', flexShrink: 0 },
  balance: { fontFamily: 'InterMedium', fontSize: 11, color: palette.muted },
  turnAmount: { fontFamily: 'InterSemiBold', fontSize: 14, color: palette.muted, marginTop: 1 },
});
