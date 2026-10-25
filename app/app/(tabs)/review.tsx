import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { ReviewItemDto } from "@sark/shared";
import { useAnswerReview, useReview } from "../../src/api/hooks";
import { EmptyState, ErrorState, Loading } from "../../src/components/ui";
import { colors, radius, space } from "../../src/theme";

function ReviewCard({ item }: { item: ReviewItemDto }) {
  const answer = useAnswerReview();
  const multi = item.kind === "attendees";
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((cur) => (multi ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));

  const submit = () => {
    if (multi) answer.mutate({ id: item.id, body: { personIds: selected } });
    else answer.mutate({ id: item.id, body: { payerId: selected[0] } });
  };
  const dismiss = () => answer.mutate({ id: item.id, body: { dismiss: true } });

  return (
    <View style={styles.card}>
      <Text style={styles.question}>{item.question}</Text>
      <Text style={styles.summary}>{item.eventSummary}</Text>
      <Text style={styles.hint}>{multi ? "Select everyone who was there" : "Select one"}</Text>
      <View style={styles.chips}>
        {(item.options ?? []).map((o) => {
          const on = selected.includes(o.personId);
          return (
            <Pressable
              key={o.personId}
              onPress={() => toggle(o.personId)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.name}</Text>
            </Pressable>
          );
        })}
      </View>
      {answer.isError ? <Text style={styles.error}>Could not save. Try again.</Text> : null}
      <View style={styles.actions}>
        <Pressable
          onPress={submit}
          disabled={selected.length === 0 || answer.isPending}
          style={[styles.primary, (selected.length === 0 || answer.isPending) && styles.disabled]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>{answer.isPending ? "Saving..." : "Submit"}</Text>
        </Pressable>
        <Pressable onPress={dismiss} disabled={answer.isPending} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>Not social / dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ReviewScreen() {
  const q = useReview();
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <FlatList
      data={q.data ?? []}
      keyExtractor={(i) => i.id}
      contentContainerStyle={styles.list}
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
      ListEmptyComponent={<EmptyState title="All caught up" body="Nothing needs your review right now." />}
      renderItem={({ item }) => <ReviewCard item={item} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md, flexGrow: 1, maxWidth: 720, width: "100%", alignSelf: "center" },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.lg, borderWidth: 1, borderColor: colors.border, gap: space.sm },
  question: { fontSize: 17, fontWeight: "700", color: colors.text },
  summary: { fontSize: 14, color: colors.muted },
  hint: { fontSize: 12, color: colors.muted, marginTop: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 15, color: colors.text, fontWeight: "500" },
  chipTextOn: { color: "#fff" },
  error: { color: colors.red, fontSize: 13 },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.md, alignItems: "center" },
  primary: { backgroundColor: colors.primary, paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.pill },
  primaryText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.4 },
  secondary: { paddingHorizontal: space.lg, paddingVertical: space.md },
  secondaryText: { color: colors.muted, fontWeight: "600" },
});
