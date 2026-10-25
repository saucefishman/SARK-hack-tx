import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, space } from "../theme";

export function Loading({ label = "Loading..." }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Could not load data</Text>
      <Text style={styles.muted}>{msg}</Text>
      <Pressable onPress={onRetry} style={styles.button} accessibilityRole="button">
        <Text style={styles.buttonText}>Retry</Text>
      </Pressable>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.muted}>{body}</Text> : null}
    </View>
  );
}

export type BadgeTone = "green" | "red" | "amber" | "grey" | "primary";
const tones: Record<BadgeTone, { bg: string; fg: string }> = {
  green: { bg: colors.greenSoft, fg: colors.green },
  red: { bg: colors.redSoft, fg: colors.red },
  amber: { bg: colors.amberSoft, fg: colors.amber },
  grey: { bg: colors.greySoft, fg: colors.grey },
  primary: { bg: colors.primarySoft, fg: colors.primary },
};

export function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  const t = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm },
  title: { fontFamily: "Inter", fontSize: 17, fontWeight: "600", color: colors.text, textAlign: "center" },
  muted: { fontFamily: "Inter", fontSize: 14, color: colors.muted, textAlign: "center" },
  button: {
    marginTop: space.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.pill,
  },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { fontFamily: "Inter", fontSize: 12, fontWeight: "600" },
});
