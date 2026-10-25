import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { FriendEntry } from "@sark/shared";
import { useFriend } from "../api/hooks";
import {
  Badge,
  EmptyState,
  ErrorState,
  Loading,
  type BadgeTone,
} from "../components/ui";
import {
  balanceLabel,
  formatCents,
  formatDate,
  formatDateTime,
} from "../format";
import { Avatar, Blue, Icon, Money, palette } from "./kit";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space } from "../theme";

const basisBadge = (
  b: FriendEntry["basis"],
): { label: string; tone: BadgeTone } => {
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
              {open ? "Hide" : "Show"} evidence ({e.evidence.length})
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useFriend(id);
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Not found" />;
  const { friend, entries } = q.data;

  // Group by event (null event = "Other").
  const groups = new Map<
    string,
    { key: string; event: FriendEntry["event"]; rows: FriendEntry[] }
  >();
  for (const e of entries) {
    const key = e.event?.id ?? "none";
    if (!groups.has(key)) groups.set(key, { key, event: e.event, rows: [] });
    groups.get(key)!.rows.push(e);
  }

  return (
    <ScrollView
        showsVerticalScrollIndicator={false}
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: 40 + insets.bottom },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={q.isRefetching}
          onRefresh={() => void q.refetch()}
        />
      }
    >
      <Stack.Screen options={{ headerShown: false }} />
      <Blue
        style={{
          padding: 24,
          paddingTop: insets.top + 22,
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to overview"
          onPress={() => router.back()}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 25,
          }}
        >
          <Icon name="back" size={20} color="#fff" />
          <Text
            style={{ fontFamily: "InterMedium", fontSize: 12, color: "#fff" }}
          >
            Your circle
          </Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar name={friend.name} size={48} />
          <View>
            <Text
              style={{ fontFamily: "Poppins", fontSize: 24, color: "#fff" }}
            >
              {friend.name}
            </Text>
            <Text
              style={{
                fontFamily: "Inter",
                fontSize: 11,
                color: "#d8e8ff",
                marginTop: 3,
              }}
            >
              {friend.eventCount} shared moments
            </Text>
          </View>
        </View>
        <View style={{ marginTop: 25 }}>
          <Text style={{ fontFamily: "Inter", fontSize: 12, color: "#d8e8ff" }}>
            {friend.balanceCents > 0
              ? "Owes you"
              : friend.balanceCents < 0
                ? "You owe"
                : "Settled"}
          </Text>
          <Text
            style={{
              fontFamily: "InterSemiBold",
              fontSize: 45,
              letterSpacing: -1.5,
              color: "#fff",
              marginTop: 5,
            }}
          >
            <Money cents={Math.abs(friend.balanceCents)} light />
          </Text>
        </View>
        <View
          style={{
            flexDirection: "row",
            gap: 28,
            marginTop: 20,
            borderTopWidth: 1,
            borderColor: "#ffffff30",
            paddingTop: 15,
          }}
        >
          <View>
            <Text
              style={{ fontFamily: "Inter", fontSize: 10, color: "#ffffffad" }}
            >
              You spent
            </Text>
            <Text
              style={{
                fontFamily: "InterMedium",
                fontSize: 18,
                color: "#fff",
                marginTop: 5,
              }}
            >
              {formatCents(friend.youSpentOnThemCents)}
            </Text>
          </View>
          <View>
            <Text
              style={{ fontFamily: "Inter", fontSize: 10, color: "#ffffffad" }}
            >
              Spent on you
            </Text>
            <Text
              style={{
                fontFamily: "InterMedium",
                fontSize: 18,
                color: "#fff",
                marginTop: 5,
              }}
            >
              {formatCents(friend.spentOnYouCents)}
            </Text>
          </View>
        </View>
      </Blue>
      <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
        <Text
          style={{ fontFamily: "Poppins", fontSize: 23, color: palette.ink }}
        >
          Shared activity
        </Text>
        <Text
          style={{
            fontFamily: "Inter",
            fontSize: 10,
            color: palette.muted,
            marginTop: 5,
          }}
        >
          Possible spending: {formatCents(friend.possibleCents)} · excluded from
          balance
        </Text>
      </View>

      {entries.length === 0 ? <EmptyState title="No entries yet" /> : null}

      {[...groups.values()].map((g) => (
        <View key={g.key} style={styles.group}>
          <Text style={styles.groupTitle}>
            {g.event?.description ?? "Other activity"}
          </Text>
          {g.event ? (
            <Text style={styles.groupMeta}>
              {formatDate(g.event.date)}
              {g.event.attendees.length
                ? ` · ${g.event.attendees.map((a) => a.name).join(", ")}`
                : ""}
            </Text>
          ) : null}
          {g.rows.map((e) => (
            <EntryRow key={e.id} e={e} />
          ))}
        </View>
      ))}

      <Text style={styles.footer}>
        Estimates are heuristic. Splits assume equal shares.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, width: "100%", maxWidth: 840, alignSelf: "center" },
  summary: {
    backgroundColor: colors.card,
    borderRadius: 26,
    padding: 24,
    borderWidth: 0,
    borderColor: colors.border,
  },
  sumLabel: { fontFamily: "Inter", fontSize: 13, color: colors.muted },
  sumHeadline: {
    fontSize: 42,
    fontFamily: "InterSemiBold",
    letterSpacing: -1.6,
    color: colors.text,
  },
  sumSecondary: { fontFamily: "Inter", fontSize: 15, color: colors.muted },
  group: {
    marginHorizontal: 18,
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e9eef7",
  },
  groupTitle: {
    fontSize: 16,
    fontFamily: "Poppins",
    letterSpacing: -0.3,
    color: palette.ink,
  },
  groupMeta: {
    fontFamily: "Inter",
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
    marginBottom: space.sm,
  },
  entry: {
    paddingTop: space.md,
    marginTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: space.sm,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  flow: {
    fontFamily: "Inter",
    fontSize: 12,
    color: colors.text,
    flexShrink: 1,
  },
  amount: {
    fontSize: 16,
    fontFamily: "InterSemiBold",
    letterSpacing: -0.6,
    color: colors.text,
  },
  badges: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  link: {
    fontFamily: "Inter",
    fontSize: 11,
    color: colors.primary,
    fontWeight: "600",
  },
  receipt: {
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: space.md,
  },
  snippet: {
    fontFamily: "Inter",
    fontSize: 12,
    color: colors.text,
    fontStyle: "italic",
  },
  ts: { fontFamily: "Inter", fontSize: 12, color: colors.muted, marginTop: 4 },
  footer: {
    fontFamily: "Inter",
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
    paddingVertical: space.md,
  },
});
