import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  Animated,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { USER_ID, type FriendEntry } from "@sark/shared";
import { useFriend } from "../api/hooks";
import { EmptyState, ErrorState, Loading } from "../components/ui";
import { formatCents } from "../format";
import { DebtDrain, type DrainScroll } from "./DebtDrain";
import { EventRow, EventSheet } from "./EventCard";
import type { SharedExperience } from "./events-presentation";
import { FriendSuggestion } from "./FriendSuggestion";
import { netSpend } from "./ledger-presentation";
import { Avatar, WarmSurface, Icon, palette } from "./kit";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, space } from "../theme";

// Plain-language rows: who covered whom, no pipeline details (basis badges, confidence, message evidence).
function EntryRow({ e, friendName }: { e: FriendEntry; friendName: string }) {
  const fromFriend = e.payerName === friendName;
  const text = e.kind === "repayment"
    ? fromFriend ? `${friendName} paid you back` : `You paid ${friendName} back`
    : fromFriend ? `${friendName} covered you` : `You covered ${friendName}`;
  return (
    <View style={styles.rowBetween}>
        <Text style={[styles.flow, e.basis === "assumed" && { color: colors.muted }]}>
          {text}{e.basis === "assumed" ? " (maybe)" : ""}
        </Text>
        <Text style={[styles.amount, e.basis === "assumed" && { color: colors.muted }]}>
          {e.basis === "estimated" ? "≈ " : ""}{formatCents(e.amountCents)}
        </Text>
    </View>
  );
}

export default function FriendDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useFriend(id);
  const [selected, setSelected] = useState<SharedExperience | null>(null);
  // Feeds the debt drain, which plays in step with the scroll.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [page, setPage] = useState({ viewport: 0, content: 0, offset: 0 });
  const drainScroll: DrainScroll | undefined = page.viewport && page.content ? { y: scrollY, ...page } : undefined;
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Not found" />;
  const { friend, entries } = q.data;
  const net = netSpend(friend);

  // Group by event (null event = repayments, shown as "Paid back").
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
    <Animated.ScrollView
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
      onLayout={(e) => { const viewport = e.nativeEvent.layout.height; setPage((p) => ({ ...p, viewport })); }}
      onContentSizeChange={(_, content) => setPage((p) => ({ ...p, content }))}
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
      <WarmSurface
        style={{
          padding: 24,
          paddingTop: insets.top + 22,
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
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
            Back
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
                color: "#f9e2de",
                marginTop: 3,
              }}
            >
              {friend.eventCount} shared moments
            </Text>
          </View>
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
              You covered
            </Text>
            <Text
              style={{
                fontFamily: "InterMedium",
                fontSize: 18,
                color: "#fff",
                marginTop: 5,
              }}
            >
              {formatCents(net.youCoveredCents)}
            </Text>
          </View>
          <View>
            <Text
              style={{ fontFamily: "Inter", fontSize: 10, color: "#ffffffad" }}
            >
              {friend.name} covered
            </Text>
            <Text
              style={{
                fontFamily: "InterMedium",
                fontSize: 18,
                color: "#fff",
                marginTop: 5,
              }}
            >
              {formatCents(net.theyCoveredCents)}
            </Text>
          </View>
        </View>
        {net.repaidCents !== 0 && (
          <Text style={{ fontFamily: "Inter", fontSize: 10, color: "#ffffffad", marginTop: 8 }}>
            After {formatCents(Math.abs(net.repaidCents))} already paid back
          </Text>
        )}
      </WarmSurface>
      <View style={{ paddingHorizontal: 20, gap: 16 }} onLayout={(e) => { const offset = e.nativeEvent.layout.y; setPage((p) => ({ ...p, offset })); }}>
        <DebtDrain id={friend.personId} name={friend.name} scroll={drainScroll} />
        <FriendSuggestion id={friend.personId} name={friend.name} embedded />
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
        <Text
          style={{ fontFamily: "Poppins", fontSize: 23, color: palette.ink }}
        >
          Shared activity
        </Text>
        {friend.possibleCents > 0 && (
          <Text
            style={{
              fontFamily: "Inter",
              fontSize: 10,
              color: palette.muted,
              marginTop: 5,
            }}
          >
            {formatCents(friend.possibleCents)} marked “maybe” isn’t counted until you confirm it in Events.
          </Text>
        )}
      </View>

      {entries.length === 0 ? <EmptyState title="No entries yet" /> : null}

      <View style={{ paddingHorizontal: 18 }}>
        {[...groups.values()].map((g) => {
          const lines = g.rows.map((e) => <EntryRow key={e.id} e={e} friendName={friend.name} />);
          if (!g.event) return <View key={g.key} style={styles.group}><Text style={styles.groupTitle}>Paid back</Text>{lines}</View>;
          const event: SharedExperience = {
            id: g.event.id,
            title: g.event.description,
            date: g.event.date,
            friends: g.event.attendees.filter((a) => a.personId !== USER_ID),
            totalCents: g.event.totalCents,
            payerId: g.event.payerIds?.[0],
          };
          return <EventRow key={g.key} event={event} onPress={() => setSelected(event)} footer={lines} />;
        })}
      </View>

      <Text style={styles.footer}>
        ≈ marks an estimated share.
      </Text>
      <EventSheet event={selected} visible={!!selected} onClose={() => setSelected(null)} />
    </Animated.ScrollView>
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
    marginBottom: 10,
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#f5edeb",
  },
  groupTitle: {
    fontSize: 16,
    fontFamily: "Poppins",
    letterSpacing: -0.3,
    color: palette.ink,
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
    fontSize: 14,
    fontFamily: "InterSemiBold",
    letterSpacing: -0.6,
    color: colors.text,
  },
  footer: {
    fontFamily: "Inter",
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
    paddingVertical: space.md,
  },
});
