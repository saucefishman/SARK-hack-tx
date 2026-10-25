import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { USER_ID } from '@sark/shared';
import { useEditEvent, useFriends } from '../api/hooks';
import { formatCents, formatDate } from '../format';
import { Action, Avatar, Icon, Sheet, palette } from './kit';
import type { SharedExperience } from './events-presentation';

// Shared event list row + detail/edit sheet, used by the Events tab and a friend's balance page.

type Draft = { title: string; date: string; attendeeIds: string[]; amount: string; payerId: string };

/** "42", "42.5", "$1,042.50" -> cents; null when blank; NaN when not a positive amount. */
function parseCents(amount: string) {
  const clean = amount.replace(/[$,\s]/g, '');
  if (!clean) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return NaN;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 ? cents : NaN;
}

const validDraft = (draft: Draft) =>
  !!draft.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && !Number.isNaN(Date.parse(draft.date)) && draft.attendeeIds.length > 0 && !Number.isNaN(parseCents(draft.amount));

export function monthLabel(date: string) {
  const [year, month] = date.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Date tile, title, attendee avatars; `footer` adds lines under the row (e.g. who covered whom). */
export function EventRow({ event, onPress, footer }: { event: SharedExperience; onPress: () => void; footer?: ReactNode }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`View ${event.title}, ${formatDate(event.date)}, with ${event.friends.map(friend => friend.name).join(', ')}`} onPress={onPress} style={({ pressed }) => [s.event, { opacity: pressed ? 0.75 : 1 }]}>
    <View style={s.eventMain}>
      <View style={s.dateTile}><Text style={s.day}>{Number(event.date.slice(8, 10))}</Text><Text style={s.dateMonth}>{new Date(`${event.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}><Text style={s.eventTitle}>{event.title}</Text><View style={s.participants}><View style={s.avatars}>{event.friends.slice(0, 3).map((friend, i) => <View key={friend.personId} style={{ marginLeft: i ? -6 : 0 }}><Avatar name={friend.name} size={23} /></View>)}</View><Text numberOfLines={2} style={s.friendNames}>{event.friends.map(friend => friend.name).join(', ')}</Text></View></View>
      <Icon name="chevron" size={18} color={palette.muted} />
    </View>
    {footer && <View style={s.footer}>{footer}</View>}
  </Pressable>;
}

/** Event details with "Edit event" (name, date, who was there, what it cost and who paid). Saving refetches balances. */
export function EventSheet({ event, visible, onClose }: { event: SharedExperience | null; visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const friends = useFriends();
  const edit = useEditEvent();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<SharedExperience | null>(null);
  useEffect(() => { if (visible) { setDraft(null); setSaved(null); edit.reset(); } }, [visible, event?.id]);
  const current = saved?.id === event?.id ? saved : event;
  const payerName = (id: string) => id === USER_ID ? 'you' : current?.friends.find(friend => friend.personId === id)?.name ?? friends.data?.find(friend => friend.personId === id)?.name ?? 'someone';
  return <Sheet visible={visible} onClose={onClose} label="Shared experience">
    {current && !draft && <View style={{ gap: 17 }}>
      <Text style={s.eyebrow}>A SHARED MEMORY</Text>
      <Text style={s.detailTitle}>{current.title}</Text>
      <Text style={s.description}>{formatDate(current.date)}{current.totalCents ? ` · ${formatCents(current.totalCents)}${current.payerId ? `, paid by ${payerName(current.payerId)}` : ''}` : ''}</Text>
      <Action title="Edit event" secondary onPress={() => { edit.reset(); setDraft({ title: current.title, date: current.date, attendeeIds: current.friends.map(friend => friend.personId), amount: current.totalCents ? (current.totalCents / 100).toFixed(2) : '', payerId: current.payerId ?? USER_ID }); }} />
      <Text style={s.sectionTitle}>Together with</Text>
      {current.friends.map(friend => <Pressable accessibilityRole="button" accessibilityLabel={`View your balance with ${friend.name}`} key={friend.personId} onPress={() => { onClose(); router.push({ pathname: '/friends/[id]', params: { id: friend.personId } }); }} style={s.personRow}><Avatar name={friend.name} size={42} /><Text style={s.personName}>{friend.name}</Text><Icon name="chevron" size={20} color={palette.muted} /></Pressable>)}
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
        {(friends.data ?? []).map(friend => {
          const on = draft.attendeeIds.includes(friend.personId);
          return <Pressable key={friend.personId} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setDraft({ ...draft, attendeeIds: on ? draft.attendeeIds.filter(id => id !== friend.personId) : [...draft.attendeeIds, friend.personId], payerId: on && draft.payerId === friend.personId ? USER_ID : draft.payerId })} style={[s.chip, on && s.chipOn]}>
            <Avatar name={friend.name} size={22} /><Text style={[s.chipText, on && { color: '#fff' }]}>{friend.name}</Text>
          </Pressable>;
        })}
      </View>
      <Text style={s.label}>Total cost ($)</Text>
      <TextInput accessibilityLabel="Total cost in dollars" value={draft.amount} onChangeText={amount => setDraft({ ...draft, amount })} placeholder="0.00" placeholderTextColor={palette.muted} keyboardType="decimal-pad" style={s.input} />
      <Text style={s.label}>Who paid</Text>
      <View style={s.chips}>
        {[{ personId: USER_ID, name: 'You' }, ...(friends.data ?? []).filter(friend => draft.attendeeIds.includes(friend.personId))].map(person => {
          const on = draft.payerId === person.personId;
          return <Pressable key={person.personId} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setDraft({ ...draft, payerId: person.personId })} style={[s.chip, on && s.chipOn]}>
            <Avatar name={person.name} size={22} /><Text style={[s.chipText, on && { color: '#fff' }]}>{person.name}</Text>
          </Pressable>;
        })}
      </View>
      <Text style={s.source}>Split evenly between everyone who was there.</Text>
      {(edit.isError || !validDraft(draft)) && <Text accessibilityRole="alert" style={s.error}>{edit.isError ? 'Couldn’t save. Please try again.' : 'Add a name, a valid date, at least one friend and a valid amount.'}</Text>}
      <Action title={edit.isPending ? 'Saving…' : 'Save changes'} onPress={() => {
        if (!validDraft(draft) || edit.isPending) return;
        // Money is sent only when it changed: saving it turns an estimate or a guessed payer into a confirmed one.
        const cents = parseCents(draft.amount);
        const totalChanged = cents !== null && cents !== current.totalCents;
        const payerChanged = draft.payerId !== (current.payerId ?? USER_ID);
        const money = totalChanged || payerChanged ? { payerId: draft.payerId, ...(totalChanged ? { totalCents: cents } : {}) } : {};
        edit.mutate({ id: current.id, body: { description: draft.title.trim(), date: draft.date, attendeeIds: draft.attendeeIds, ...money } }, {
          onSuccess: () => { setSaved({ ...current, title: draft.title.trim(), date: draft.date, friends: (friends.data ?? []).filter(friend => draft.attendeeIds.includes(friend.personId)).map(friend => ({ personId: friend.personId, name: friend.name })), totalCents: cents ?? current.totalCents, payerId: draft.payerId }); setDraft(null); },
        });
      }} />
      <Action title="Cancel" secondary onPress={() => setDraft(null)} />
    </View>}
  </Sheet>;
}

const s = StyleSheet.create({
  event: { padding: 14, borderRadius: 22, backgroundColor: '#fffdfb', borderWidth: 1, borderColor: '#eee3dc', marginBottom: 10 },
  eventMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  footer: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderColor: palette.line, gap: 6 },
  dateTile: { width: 47, minHeight: 56, borderRadius: 15, backgroundColor: '#f7ece5', alignItems: 'center', justifyContent: 'center', gap: 2 },
  day: { fontFamily: 'Poppins', fontSize: 22, lineHeight: 29, color: '#a95748' },
  dateMonth: { fontFamily: 'InterMedium', fontSize: 9, letterSpacing: 0.7, color: '#b08978' },
  eventTitle: { fontFamily: 'Poppins', fontSize: 14, lineHeight: 21, color: palette.ink },
  participants: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 8 },
  avatars: { flexDirection: 'row' },
  friendNames: { flex: 1, fontFamily: 'Inter', fontSize: 10, lineHeight: 16, color: palette.muted },
  eyebrow: { fontFamily: 'InterMedium', fontSize: 9, lineHeight: 15, letterSpacing: 1.1, color: '#a36d5e' },
  detailTitle: { fontFamily: 'Poppins', fontSize: 25, lineHeight: 34, letterSpacing: -0.6, color: palette.ink, paddingRight: 24 },
  description: { fontFamily: 'Inter', fontSize: 12, lineHeight: 20, color: '#987a6c' },
  sectionTitle: { fontFamily: 'Poppins', fontSize: 18, letterSpacing: -0.5, color: palette.ink },
  source: { fontFamily: 'Inter', fontSize: 10, lineHeight: 17, color: '#a48a7e' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fffdfb', padding: 12, borderRadius: 17, borderWidth: 1, borderColor: palette.line },
  personName: { flex: 1, fontFamily: 'Poppins', fontSize: 15, color: palette.ink },
  error: { fontFamily: 'Inter', fontSize: 11, lineHeight: 18, color: '#a54e45' },
  label: { fontFamily: 'InterMedium', fontSize: 11, color: palette.muted },
  input: { fontFamily: 'Inter', fontSize: 15, color: palette.ink, backgroundColor: '#fffdfb', borderWidth: 1, borderColor: palette.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: '#fffdfb' },
  chipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  chipText: { fontFamily: 'InterMedium', fontSize: 12, color: palette.ink },
});
