import { useState } from "react";
import { useRouter } from "expo-router";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { FriendSummary } from "@sark/shared";
import { useFriends, useReview } from "../api/hooks";
import { ErrorState, Loading } from "../components/ui";
import { formatCents } from "../format";
import { AccountSheet } from "./AccountSheet";
import { ReviewSheet } from "./Review";
import {
  Avatar,
  NativeCanvas,
  Details,
  Header,
  Icon,
  Money,
  Selector,
  Sheet,
  nativeStyles,
  palette,
} from "./kit";
import { filterFriends, summarizeFriends } from "./ledger-presentation";
import { exportLedger } from "./export-ledger";

const filters = ["Everyone", "Owes you", "You owe", "Settled"];
export default function Overview() {
  const router = useRouter();
  const query = useFriends();
  const reviews = useReview();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState(0);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [friend, setFriend] = useState<FriendSummary | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const friends = query.data ?? [];
  const { owedCents: owed, owingCents: owe, spentCents: spent, receivedCents: received } = summarizeFriends(friends);
  const shown = filterFriends(friends, filter, search);
  const currentFriend = friends.find(person => person.personId === friend?.personId) ?? friend;
  async function download() {
    setExporting(true);
    try {
      await exportLedger(shown);
    } catch {
      Alert.alert("Export failed", "Please try again.");
    } finally {
      setExporting(false);
    }
  }
  if (query.isLoading) return <Loading label="Loading your circle…" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  return (
    <View style={s.screen}>
      <NativeCanvas>
        <View style={s.pinnedHeader}>
          <Header onAccount={() => setAccount(true)} />
          <View style={s.pinnedBalance}>
            <Text style={s.balanceLabel}>Shared balance</Text>
            <Text style={s.balance} adjustsFontSizeToFit numberOfLines={1}>
              <Money cents={owed - owe} light />
            </Text>
          </View>
        </View>
        <View style={s.scrollRegion}>
          <View pointerEvents="none" style={s.pullBackground} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
              tintColor="#fff"
              colors={["#fff"]}
              progressBackgroundColor="#3478df"
            />
          }
        >
          <View style={s.scrollingHero}>
            <View style={s.hero}>
              <View style={s.splits}>
                <View style={s.inline}>
                  <Text style={s.splitLabel}>You're owed</Text>
                  <Text style={s.splitValue}>
                    <Money cents={owed} light />
                  </Text>
                </View>
                <View style={[s.inline, s.divider]}>
                  <Text style={s.splitLabel}>You owe</Text>
                  <Text style={s.splitValue}>
                    <Money cents={owe} light />
                  </Text>
                </View>
              </View>
              <View style={s.summary}>
                <View style={{ flex: 1 }}>
                  <Text style={s.summaryLabel}>You spent on friends</Text>
                  <Text style={s.summaryAmount}>
                    <Money cents={spent} light />
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.summaryLabel}>Friends spent on you</Text>
                  <Text style={s.summaryAmount}>
                    <Money cents={received} light />
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setReviewOpen(true)}
                style={({ pressed }) => [
                  s.review,
                  { opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Icon name="review" size={18} color="#fff" />
                <Text style={s.reviewText}>Review activity</Text>
                <Text style={s.count}>{reviews.data?.length ?? 0}</Text>
                <Icon name="arrow" size={17} color="#fff" />
              </Pressable>
            </View>
            <View style={s.roundedLip} />
          </View>
          <View style={[s.friends, { paddingBottom: 115 + insets.bottom }]}>
            <View style={s.sectionHeading}>
              <Text style={nativeStyles.title}>Friends</Text>
              <View style={nativeStyles.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Search friends"
                  accessibilityState={{ expanded: searchOpen }}
                  hitSlop={10}
                  onPress={() => {
                    setSearchOpen(!searchOpen);
                    setSearch("");
                  }}
                >
                  <Icon name="search" size={20} color="#8197b4" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={exporting || !shown.length}
                  onPress={() => void download()}
                  style={[
                    nativeStyles.row,
                    { opacity: exporting || !shown.length ? 0.4 : 1 },
                  ]}
                >
                  <Icon name="download" size={18} color="#8197b4" />
                  <Text style={nativeStyles.caption}>
                    {exporting ? "Exporting…" : "Export"}
                  </Text>
                </Pressable>
              </View>
            </View>
            <Selector
              options={filters.map((label) => ({ key: label, label }))}
              index={filter}
              onSelect={setFilter}
            />
            {searchOpen && (
              <View style={s.search}>
                <Icon name="search" size={19} color="#9aacc3" />
                <TextInput
                  autoFocus
                  accessibilityLabel="Search friends by name"
                  placeholder="Search friends"
                  placeholderTextColor="#94a5bc"
                  value={search}
                  onChangeText={setSearch}
                  style={s.input}
                />
              </View>
            )}
            <View style={s.list}>
              {shown.map((item) => (
                <Pressable
                  key={item.personId}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${item.name}'s balance`}
                  onPress={() => {
                    setFriend(item);
                    setDetailsOpen(true);
                  }}
                  style={({ pressed }) => [
                    s.friend,
                    { transform: [{ scale: pressed ? 0.985 : 1 }] },
                  ]}
                >
                  <Avatar name={item.name} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{item.name}</Text>
                    <Text style={s.moments}>
                      {item.eventCount} shared moments
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.friendAmount}>
                      <Money cents={Math.abs(item.balanceCents)} />
                    </Text>
                    <Text style={s.status}>
                      {item.balanceCents > 0
                        ? "Owes you"
                        : item.balanceCents < 0
                          ? "You owe"
                          : "Settled"}
                    </Text>
                  </View>
                  <Icon name="chevron" size={17} color="#afbed2" />
                </Pressable>
              ))}
            </View>
            {!shown.length && (
              <View style={s.empty}>
                <Text style={nativeStyles.body}>
                  {friends.length
                    ? "No balances match this view."
                    : "No shared activity yet."}
                </Text>
                {friends.length > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setFilter(0);
                      setSearch("");
                    }}
                  >
                    <Text style={s.reset}>Show everyone</Text>
                  </Pressable>
                )}
              </View>
            )}
            <Text style={s.foot}>
              Includes confirmed and estimated activity.
            </Text>
          </View>
        </ScrollView>
        </View>
      </NativeCanvas>
      <ReviewSheet visible={reviewOpen} onClose={() => setReviewOpen(false)} />
      <AccountSheet
        visible={account}
        onClose={() => setAccount(false)}
        owed={owed}
        owe={owe}
      />
      <Sheet
        visible={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        label={currentFriend ? `${currentFriend.name} details` : "Friend details"}
      >
        {currentFriend && (
          <Details
            name={currentFriend.name}
            caption={
              currentFriend.balanceCents > 0
                ? "Owes you"
                : currentFriend.balanceCents < 0
                  ? "You owe"
                  : "Settled"
            }
            balance={Math.abs(currentFriend.balanceCents)}
            rows={[
              ["Shared moments", String(currentFriend.eventCount)],
              ["You spent", formatCents(currentFriend.youSpentOnThemCents)],
              ["Spent on you", formatCents(currentFriend.spentOnYouCents)],
            ]}
            onClose={() => setDetailsOpen(false)}
            onActivity={() => {
              setDetailsOpen(false);
              router.push({
                pathname: "/friends/[id]",
                params: { id: currentFriend.personId },
              });
            }}
          />
        )}
      </Sheet>
    </View>
  );
}
const s = StyleSheet.create({
  scrollRegion: { flex: 1, backgroundColor: palette.bg },
  pullBackground: { position: "absolute", top: 0, left: 0, right: 0, height: "50%", backgroundColor: "#3478df" },
  pinnedHeader: { backgroundColor: "#3478df", zIndex: 2 },
  pinnedBalance: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 14 },
  scrollingHero: { backgroundColor: "#3478df" },
  screen: { flex: 1, backgroundColor: palette.bg },
  hero: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 24 },
  balanceLabel: { fontFamily: "InterMedium", fontSize: 13, color: "#ffffffc9" },
  balance: {
    fontFamily: "InterSemiBold",
    fontSize: 54,
    letterSpacing: -2.8,
    color: "#fff",
    marginTop: 6,
  },
  splits: { flexDirection: "row", gap: 20, marginTop: 12 },
  inline: { flexDirection: "row", alignItems: "center", gap: 7 },
  divider: { paddingLeft: 20, borderLeftWidth: 1, borderColor: "#ffffff40" },
  splitLabel: { fontFamily: "Inter", fontSize: 10, color: "#ffffffad" },
  splitValue: { fontFamily: "InterMedium", fontSize: 12, color: "#fff" },
  summary: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#ffffff30",
    paddingTop: 13,
    marginTop: 18,
  },
  summaryLabel: { fontFamily: "Inter", fontSize: 10, color: "#ffffffad" },
  summaryAmount: {
    fontFamily: "InterMedium",
    fontSize: 18,
    letterSpacing: -0.5,
    color: "#fff",
    marginTop: 5,
  },
  review: {
    height: 41,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#ffffff50",
    backgroundColor: "#ffffff20",
    marginTop: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  reviewText: { fontFamily: "InterMedium", fontSize: 12, color: "#fff" },
  count: {
    fontFamily: "Inter",
    fontSize: 10,
    color: "#fff",
    backgroundColor: "#ffffff29",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 11,
  },
  roundedLip: {
    height: 27,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: palette.bg,
  },
  friends: { flexGrow: 1, paddingHorizontal: 20, backgroundColor: palette.bg },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },
  search: {
    height: 40,
    borderRadius: 13,
    backgroundColor: "#e7edf6",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  input: {
    flex: 1,
    fontFamily: "Inter",
    fontSize: 12,
    color: palette.ink,
    paddingVertical: 8,
  },
  list: { gap: 8, marginTop: 12 },
  friend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "#fff",
    padding: 12,
    backgroundColor: "#fff",
  },
  name: { fontFamily: "Poppins", fontSize: 12, color: palette.ink },
  moments: {
    fontFamily: "Inter",
    fontSize: 10,
    color: "#9ba7b8",
    marginTop: 3,
  },
  friendAmount: {
    fontFamily: "InterSemiBold",
    fontSize: 16,
    letterSpacing: -0.5,
    color: palette.ink,
  },
  status: { fontFamily: "Inter", fontSize: 10, color: "#6991c7", marginTop: 4 },
  foot: {
    fontFamily: "Inter",
    fontSize: 9,
    color: "#a3afbf",
    marginTop: 12,
    paddingLeft: 4,
  },
  empty: { alignItems: "center", paddingVertical: 25, gap: 12 },
  reset: { fontFamily: "InterMedium", fontSize: 12, color: palette.blue },
});
