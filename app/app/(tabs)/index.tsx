import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { FriendSummary } from "@sark/shared";
import { useFriends } from "../../src/api/hooks";
import { Badge, EmptyState, ErrorState, Loading } from "../../src/components/ui";
import { balanceLabel, formatCents } from "../../src/format";
import { colors, radius, space } from "../../src/theme";

export function balanceTone(c: number) {
  return c > 0 ? ("green" as const) : c < 0 ? ("red" as const) : ("grey" as const);
}

function FriendCard({ f, onPress }: { f: FriendSummary; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.card} accessibilityRole="button">
      <View style={styles.row}>
        <Text style={styles.name}>{f.name}</Text>
        <Text style={styles.muted}>
          {f.eventCount} {f.eventCount === 1 ? "event" : "events"}
        </Text>
      </View>
      <Text style={styles.headline}>
        {formatCents(f.spentOnYouCents)} <Text style={styles.headlineLabel}>spent on you</Text>
      </Text>
      <Text style={styles.secondary}>you spent {formatCents(f.youSpentOnThemCents)}</Text>
      <View style={[styles.row, { justifyContent: "flex-start", marginTop: space.md, gap: space.sm }]}>
        <Badge label={balanceLabel(f.balanceCents, f.name)} tone={balanceTone(f.balanceCents)} />
        {f.possibleCents > 0 ? <Badge label={`Possible ${formatCents(f.possibleCents)}`} tone="amber" /> : null}
      </View>
    </Pressable>
  );
}

export default function FriendsScreen() {
  const router = useRouter();
  const q = useFriends();
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data ?? [];
  const totalOn = data.reduce((s, f) => s + f.spentOnYouCents, 0);
  const totalBy = data.reduce((s, f) => s + f.youSpentOnThemCents, 0);

  return (
    <FlatList
      data={data}
      keyExtractor={(f) => f.personId}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
      ListHeaderComponent={
        <View style={styles.totals}>
          <View style={{ flex: 1 }}>
            <Text style={styles.totalLabel}>Total spent on you</Text>
            <Text style={styles.totalValue}>{formatCents(totalOn)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.totalLabel}>Total you spent</Text>
            <Text style={styles.totalValue}>{formatCents(totalBy)}</Text>
          </View>
        </View>
      }
      ListEmptyComponent={<EmptyState title="No friends yet" body="Once data is ingested, balances show up here." />}
      renderItem={({ item }) => (
        <FriendCard f={item} onPress={() => router.push({ pathname: "/friends/[id]", params: { id: item.personId } })} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md, maxWidth: 720, width: "100%", alignSelf: "center" },
  totals: {
    flexDirection: "row",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.lg,
  },
  totalLabel: { color: "#C7D2FE", fontSize: 13 },
  totalValue: { color: "#fff", fontSize: 24, fontWeight: "700", marginTop: 2 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.lg, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 17, fontWeight: "600", color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  headline: { fontSize: 32, fontWeight: "800", color: colors.text, marginTop: space.sm },
  headlineLabel: { fontSize: 15, fontWeight: "500", color: colors.muted },
  secondary: { fontSize: 15, color: colors.muted, marginTop: 2 },
});
