import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFriend, usePayback } from '../api/hooks';
import { ErrorState, Loading } from '../components/ui';
import { Action, Avatar, Icon, palette } from './kit';
import { activityIdeaCopy, friendActivityIdeas } from './friend-activity-ideas';
import { evenTogether, memoryHook, sendInstead, shareFootnote, yourTurnLabel } from './payback-presentation';

export function FriendSuggestion({ id, name, onActivity, embedded = false }: { id: string; name: string; onActivity?: () => void; embedded?: boolean }) {
  const query = useFriend(id);
  const suggestions = usePayback(id);
  const [index, setIndex] = useState(0);
  const ideas = friendActivityIdeas(query.data?.entries ?? [], id, suggestions.data?.suggestions.flatMap(plan => plan.items) ?? []);
  const idea = ideas[index % ideas.length];
  const copy = activityIdeaCopy(idea.source);
  // "Your turn" framing only when the user owes this friend; the suggestion is a way to return the favor.
  const debt = suggestions.data?.debtCents ?? 0;
  const item = suggestions.data?.suggestions.flatMap(plan => plan.items).find(option => option.id === idea.id);
  const memory = debt > 0 ? memoryHook(query.data?.entries ?? [], name) : null;
  const even = query.data?.friend.balanceCents === 0;
  return <View style={s.content}>
    {!embedded && <View style={s.profile}>
      <Avatar name={name} size={60} />
      <View style={{ flex: 1, paddingRight: 24 }}>
        <Text style={s.name}>{name}</Text>
        <Text style={s.caption}>{even ? evenTogether(name) : 'Make time for each other.'}</Text>
      </View>
    </View>}
    {query.isLoading || suggestions.isLoading ? <View style={s.loading}><Loading label="Finding something to do together…" /></View> : query.isError ?
      <ErrorState error={query.error} onRetry={() => void query.refetch()} /> :
      <View style={s.idea}>
        {debt > 0 ? <Text style={s.turn}>{yourTurnLabel(name)}</Text> : <Text style={s.eyebrow}>SOMETHING TO DO TOGETHER</Text>}
        <Text style={s.title}>{idea.title}</Text>
        <Text style={s.description}>{memory ?? copy.description}</Text>
        <View style={s.footer}>
          <Text style={s.basis}>{debt > 0 && item ? shareFootnote(item, debt, suggestions.data?.toleranceCents) : copy.basis}</Text>
          {debt > 0 && <Text style={s.basis}>{sendInstead(debt)}</Text>}
        </View>
      </View>}
    {suggestions.isError && query.isSuccess && <View style={{ gap: 8 }}>
      <Text style={s.caption}>Couldn’t load upcoming suggestions. Showing ideas from your shared activity.</Text>
      <Pressable accessibilityRole="button" onPress={() => void suggestions.refetch()}><Text style={s.activityText}>Retry suggestions</Text></Pressable>
    </View>}
    {query.isSuccess && !suggestions.isLoading && ideas.length > 1 && <Action title="Another idea" onPress={() => setIndex(value => value + 1)} />}
    {onActivity && <Pressable accessibilityRole="button" onPress={onActivity} style={({ pressed }) => [s.activity, { opacity: pressed ? 0.7 : 1 }]}>
      <Text style={s.activityText}>View shared activity</Text>
      <Icon name="arrow" size={18} color={palette.accent} />
    </Pressable>}
  </View>;
}

const s = StyleSheet.create({
  content: { gap: 20 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontFamily: 'Poppins', fontSize: 25, lineHeight: 34, letterSpacing: -0.6, color: palette.ink },
  caption: { fontFamily: 'Inter', fontSize: 12, lineHeight: 19, color: palette.muted, marginTop: 3 },
  idea: { borderRadius: 24, padding: 22, backgroundColor: '#f5e7df', borderWidth: 1, borderColor: '#eedbd1' },
  eyebrow: { fontFamily: 'InterMedium', fontSize: 9, lineHeight: 16, letterSpacing: 1.15, color: '#a36d5e' },
  turn: { fontFamily: 'Poppins', fontSize: 17, lineHeight: 24, letterSpacing: -0.3, color: '#a95748' },
  title: { fontFamily: 'Poppins', fontSize: 25, lineHeight: 34, letterSpacing: -0.6, color: '#623d33', marginTop: 18 },
  description: { fontFamily: 'Inter', fontSize: 13, lineHeight: 22, color: '#936e61', marginTop: 12 },
  footer: { borderTopWidth: 1, borderColor: '#e8d3c8', marginTop: 24, paddingTop: 14 },
  basis: { fontFamily: 'Inter', fontSize: 10, lineHeight: 17, color: '#a08073' },
  activity: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, minHeight: 44 },
  activityText: { fontFamily: 'InterMedium', fontSize: 12, color: palette.accent },
  loading: { minHeight: 180 },
});
