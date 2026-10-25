import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { FriendEntry } from "@sark/shared";
import { useFriend } from "../../src/api/hooks";
import { Badge, EmptyState, ErrorState, Loading, type BadgeTone } from "../../src/components/ui";
import { balanceLabel, formatCents, formatDate, formatDateTime } from "../../src/format";
import { colors, radius, space } from "../../src/theme";

const basisBadge = (b: FriendEntry["basis"]): { label: string; tone: BadgeTone } => {
  switch (b) {
    case "confirmed":
      return { label: "confirmed", tone: "green" };
    case "estimated":
      return { label: "estimated", tone: "primary" };
    case "assumed":
      return { label: "possible", tone: "amber" };
    default:
      return { label: b, tone: "grey" };
  }
};

function EntryRow({ e }: { e: FriendEntry }) {
  const [open, setOpen] = useState(false);
  const b = basisBadge(e.basis);
  return (
    <View style={styles.entry}>
      <View style={styles.rowBetween}>
        <Text style={styles.flow}>
          {e.payerName} {"→"} {e.beneficiaryName}
        </Text>
        <Text style={styles.amount}>{formatCents(e.amountCents)}</Text>
      </View>
      <View style={styles.badges}>
        <Badge label={e.kind} tone="grey" />
        <Badge label={b.label} tone={b.tone} />
      </View>
      {e.evidence.length > 0 ? (
        <>
          <Pressable onPress={() => setOpen(!open)} accessibilityRole="button">
            <Text style={styles.link}>
              {open ? "Hide" : "Show"} receipts ({e.evidence.length})
            </Text>
          </Pressable>
          {open
            ? e.evidence.map((ev) => (
                <View key={ev.messageId} style={styles.receipt}>
                  <Text style={styles.snippet}>{`“${ev.snippet}”`}</Text>
                  <Text style={styles.ts}>{formatDateTime(ev.sentAt)}</Text>
                </View>
              ))
            : null}
        </>
      ) : null}
    </View>
  );
}

export default function FriendDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useFriend(id);
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Not found" />;
  const { friend, entries } = q.data;

  // Group by event (null event = "Other").
  const groups = new Map<string, { key: string; event: FriendEntry["event"]; rows: FriendEntry[] }>();
  for (const e of entries) {
    const key = e.event?.id ?? "none";
    if (!groups.has(key)) groups.set(key, { key, event: e.event, rows: [] });
    groups.get(key)!.rows.push(e);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
    >
      <Stack.Screen options={{ title: friend.name }} />
      <View style={styles.summary}>
        <Text style={styles.sumLabel}>Spent on you</Text>
        <Text style={styles.sumHeadline}>{formatCents(friend.spentOnYouCents)}</Text>
        <Text style={styles.sumSecondary}>You spent {formatCents(friend.youSpentOnThemCents)}</Text>
        <View style={[styles.badges, { marginTop: space.md }]}>
          <Badge
            label={balanceLabel(friend.balanceCents, friend.name)}
            tone={friend.balanceCents > 0 ? "green" : friend.balanceCents < 0 ? "red" : "grey"}
          />
          {friend.possibleCents > 0 ? <Badge label={`Possible ${formatCents(friend.possibleCents)}`} tone="amber" /> : null}
        </View>
      </View>

      {entries.length === 0 ? <EmptyState title="No entries yet" /> : null}

      {[...groups.values()].map((g) => (
        <View key={g.key} style={styles.group}>
          <Text style={styles.groupTitle}>{g.event?.description ?? "Other activity"}</Text>
          {g.event ? (
            <Text style={styles.groupMeta}>
              {formatDate(g.event.date)}
              {g.event.attendees.length ? ` · ${g.event.attendees.map((a) => a.name).join(", ")}` : ""}
            </Text>
          ) : null}
          {g.rows.map((e) => (
            <EntryRow key={e.id} e={e} />
          ))}
        </View>
      ))}

      <Text style={styles.footer}>Estimates are heuristic. Splits assume equal shares.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, maxWidth: 720, width: "100%", alignSelf: "center" },
  summary: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.lg, borderWidth: 1, borderColor: colors.border },
  sumLabel: { fontSize: 13, color: colors.muted },
  sumHeadline: { fontSize: 36, fontWeight: "800", color: colors.text },
  sumSecondary: { fontSize: 15, color: colors.muted },
  group: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.lg, borderWidth: 1, borderColor: colors.border },
  groupTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  groupMeta: { fontSize: 13, color: colors.muted, marginTop: 2, marginBottom: space.sm },
  entry: { paddingTop: space.md, marginTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: space.sm },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  flow: { fontSize: 15, color: colors.text, flexShrink: 1 },
  amount: { fontSize: 16, fontWeight: "700", color: colors.text },
  badges: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  link: { fontSize: 14, color: colors.primary, fontWeight: "600" },
  receipt: { backgroundColor: colors.bg, borderRadius: radius.sm, padding: space.md },
  snippet: { fontSize: 14, color: colors.text, fontStyle: "italic" },
  ts: { fontSize: 12, color: colors.muted, marginTop: 4 },
  footer: { fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: space.md },
});
