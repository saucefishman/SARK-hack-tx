import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReviewItemDto } from "@sark/shared";
import { useAnswerReview, useFriends, useReview } from "../api/hooks";
import { EmptyState, ErrorState, Loading } from "../components/ui";
import { reviewPresentation } from "../components/review-presentation";
import { reviewAnswer, summarizeFriends } from "./ledger-presentation";
import { AccountSheet } from "./AccountSheet";
import {
  Action,
  Sheet,
  Avatar,
  NativeCanvas,
  WarmSurface,
  Header,
  Icon,
  palette,
  useReducedMotion,
} from "./kit";

function ReviewCard({ item }: { item: ReviewItemDto }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const completion = useRef<(() => void) | null>(null);
  const [height, setHeight] = useState(0);
  const [exiting, setExiting] = useState(false);
  useEffect(() => () => {
    animation.current?.stop();
    completion.current?.();
  }, []);
  const answer = useAnswerReview(() => {
    if (reduced) return Promise.resolve();
    setExiting(true);
    return new Promise<void>(resolve => {
      completion.current = resolve;
      animation.current = Animated.timing(progress, {
        toValue: 0,
        duration: 260,
        useNativeDriver: false,
      });
      animation.current.start(() => {
        completion.current = null;
        resolve();
      });
    });
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const content = reviewPresentation(item);
  const multiple = item.kind === "attendees";
  const busy = answer.isPending;
  function toggle(id: string) {
    setSelected((current) =>
      multiple
        ? current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id]
        : [id],
    );
  }
  return (
    <Animated.View pointerEvents={exiting ? "none" : "auto"} style={exiting ? {
      height: progress.interpolate({inputRange:[0,1],outputRange:[0,height]}),
      opacity: progress,
      overflow: "hidden",
      marginBottom: progress.interpolate({inputRange:[0,1],outputRange:[-12,0]}),
      transform: [{translateY: progress.interpolate({inputRange:[0,1],outputRange:[-6,0]})}],
    } : undefined}>
    <View style={s.card} onLayout={event => { if (!exiting) setHeight(event.nativeEvent.layout.height); }}>
      <View style={s.expense}>
        <View style={{ flex: 1 }}>
          <Text style={s.expenseTitle}>{content.title}</Text>
          {content.date && <Text style={s.date}>{content.date}</Text>}
        </View>
        {content.amount && <Text style={s.amount}>{content.amount}</Text>}
      </View>
      <View style={s.question}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>
            {content.eyebrow}
          </Text>
          <Text style={s.prompt}>{content.prompt}</Text>
          <Text style={s.hint}>{content.hint}</Text>
        </View>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            s.count,
            selected.length > 0 && {
              color: "#af6153",
              backgroundColor: "#fae8e5",
            },
          ]}
        >
          {selected.length
            ? `${selected.length} selected`
            : multiple
              ? "Multiple"
              : "Single"}
        </Text>
      </View>
      {item.kind === "payer" && (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: noteOpen }}
            onPress={() => setNoteOpen(!noteOpen)}
            hitSlop={5}
          >
            <Text style={s.noteToggle}>
              {noteOpen ? "Hide original note" : "Original note"}
            </Text>
          </Pressable>
          {noteOpen && <Text style={s.note}>{item.question}</Text>}
        </View>
      )}
      <View style={s.options}>
        {item.options?.map((person) => {
          const on = selected.includes(person.personId);
          return (
            <Pressable
              accessibilityRole={multiple ? "checkbox" : "radio"}
              accessibilityLabel={person.name}
              accessibilityState={{ checked: on, disabled: busy }}
              disabled={busy}
              key={person.personId}
              onPress={() => toggle(person.personId)}
              style={[s.option, on && s.optionOn]}
            >
              <Avatar name={person.name} size={32} />
              <Text style={s.person} numberOfLines={1}>
                {person.name}
              </Text>
              <View
                style={[
                  s.check,
                  !multiple && { borderRadius: 10 },
                  on && s.checked,
                ]}
              >
                {on && <Icon name="check" size={15} color="#fff" />}
              </View>
            </Pressable>
          );
        })}
      </View>
      {answer.isError && (
        <Text accessibilityRole="alert" style={s.error}>
          Couldn't save. Your selection is still here—try again.
        </Text>
      )}
      <View style={s.actions}>
        <View style={{ flex: 1 }}>
          <Action
            title={content.dismissLabel}
            secondary
            large
            disabled={busy}
            onPress={() =>
              answer.mutate({ id: item.id, body: { dismiss: true } })
            }
          />
        </View>
        <View style={{ flex: 1 }}>
          <Action
            title={busy ? "Saving…" : "Confirm"}
            large
            disabled={!selected.length || busy}
            onPress={() =>
              answer.mutate({
                id: item.id,
                body: reviewAnswer(item, selected),
              })
            }
          />
        </View>
      </View>
    </View>
    </Animated.View>
  );
}
export function ReviewSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const query = useReview();
  return (
    <Sheet visible={visible} onClose={onClose} label="Review activity">
      <Text style={[s.title, { color: palette.ink, fontSize: 25 }]}>Review activity</Text>
      <Text style={[s.subtitle, { color: "#a28782", fontSize: 13, lineHeight: 20, marginBottom: 18 }]}>
        {query.data?.length ?? 0} pending · A few details to keep your balance accurate.
      </Text>
      {query.isLoading ? <Loading label="Loading activity…" /> : query.isError ?
        <ErrorState error={query.error} onRetry={() => void query.refetch()} /> :
        <View style={{ gap: 12 }}>
          {query.data?.length ? query.data.map(item => <ReviewCard key={item.id} item={item} />) :
            <EmptyState title="You're all caught up" body="No activity left to review." />}
        </View>}
    </Sheet>
  );
}

export default function Review() {
  const query = useReview();
  const friends = useFriends();
  const insets = useSafeAreaInsets();
  const [account, setAccount] = useState(false);
  const { width } = useWindowDimensions();
  const { owedCents: owed, owingCents: owe } = summarizeFriends(friends.data ?? []);
  if (query.isLoading) return <Loading label="Loading reviews…" />;
  if (query.isError)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  return (
    <View style={s.screen}>
      <NativeCanvas>
        <ScrollView
        showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 115 + insets.bottom }}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
              tintColor="#fff"
            />
          }
        >
          <WarmSurface>
            <Header onAccount={() => setAccount(true)} />
            <View style={s.heading}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>Review</Text>
                <Text style={s.subtitle}>
                  Finish the details. Keep things balanced.
                </Text>
              </View>
              <Text style={s.pending}>{query.data?.length ?? 0} pending</Text>
            </View>
            <View style={s.lip} />
          </WarmSurface>
          <View
            style={[
              s.cards,
              width >= 700 && { flexDirection: "row", flexWrap: "wrap" },
            ]}
          >
            {query.data?.length ? (
              query.data.map((item) => (
                <View
                  key={item.id}
                  style={{ width: width >= 700 ? "48.5%" : "100%" }}
                >
                  <ReviewCard item={item} />
                </View>
              ))
            ) : (
              <View style={s.empty}>
                <EmptyState
                  title="You're all caught up"
                  body="No activity left to review."
                />
              </View>
            )}
          </View>
        </ScrollView>
      </NativeCanvas>
      <AccountSheet
        visible={account}
        onClose={() => setAccount(false)}
        owed={owed}
        owe={owe}
        available={friends.isSuccess}
        failed={friends.isError}
        onRetry={() => void friends.refetch()}
      />
    </View>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  heading: {
    paddingHorizontal: 24,
    paddingBottom: 25,
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
  },
  title: {
    fontFamily: "Poppins",
    fontSize: 29,
    letterSpacing: -0.8,
    color: "#fff",
  },
  subtitle: {
    fontFamily: "Inter",
    fontSize: 11,
    lineHeight: 18,
    color: "#f6deda",
    marginTop: 4,
  },
  pending: {
    fontFamily: "Inter",
    fontSize: 10,
    color: "#fff",
    backgroundColor: "#ffffff20",
    borderWidth: 1,
    borderColor: "#ffffff55",
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 20,
  },
  lip: {
    height: 21,
    borderTopLeftRadius: 31,
    borderTopRightRadius: 31,
    backgroundColor: palette.bg,
  },
  cards: { paddingHorizontal: 18, gap: 12 },
  card: {
    padding: 16,
    borderRadius: 24,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#f5edeb",
  },
  expense: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderBottomWidth: 1,
    borderColor: "#f5f0ef",
    paddingBottom: 12,
  },
  expenseTitle: {
    fontFamily: "Poppins",
    fontSize: 19,
    lineHeight: 27,
    letterSpacing: -0.3,
    color: palette.ink,
  },
  date: { fontFamily: "Inter", fontSize: 12, color: "#a48b87", marginTop: 5 },
  amount: {
    fontFamily: "InterSemiBold",
    fontSize: 18,
    color: "#4c302b",
    letterSpacing: -0.5,
    paddingTop: 2,
  },
  question: {
    flexDirection: "row",
    gap: 8,
    padding: 13,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#f8ecea",
    backgroundColor: "#fcf3f2",
    marginTop: 13,
  },
  eyebrow: {
    fontFamily: "InterMedium",
    fontSize: 10,
    letterSpacing: 1.2,
    color: "#b6908a",
    marginBottom: 5,
  },
  prompt: {
    fontFamily: "Poppins",
    fontSize: 18,
    lineHeight: 25,
    letterSpacing: -0.35,
    color: "#5f3c36",
  },
  hint: {
    fontFamily: "Inter",
    fontSize: 12,
    lineHeight: 18,
    color: "#9f817b",
    marginTop: 4,
  },
  count: {
    alignSelf: "flex-start",
    fontFamily: "Inter",
    fontSize: 10,
    padding: 5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#fff",
    backgroundColor: "#ffffff88",
    color: "#c1a6a1",
  },
  noteToggle: {
    fontFamily: "Inter",
    fontSize: 13,
    color: "#a3817b",
    marginTop: 9,
  },
  note: {
    fontFamily: "Inter",
    fontSize: 12,
    lineHeight: 19,
    color: "#af9894",
    backgroundColor: "#fbf7f6",
    padding: 9,
    borderRadius: 10,
    marginTop: 6,
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 10,
    marginBottom: 13,
  },
  option: {
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 56,
    padding: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#f4eceb",
    backgroundColor: "#fdf8f7",
  },
  optionOn: { borderColor: "#e6c1ba", backgroundColor: "#fbebe8" },
  person: { flex: 1, fontFamily: "Poppins", fontSize: 13, color: "#95554a" },
  check: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: "#e7d6d3",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: "#bf6353", borderColor: "#bf6353" },
  actions: { flexDirection: "row", gap: 12 },
  error: {
    fontFamily: "Inter",
    fontSize: 11,
    lineHeight: 17,
    color: "#a35151",
    backgroundColor: "#fff3f3",
    padding: 10,
    borderRadius: 11,
    marginBottom: 10,
  },
  empty: { flex: 1, minHeight: 220, backgroundColor: "#fff", borderRadius: 24 },
});
