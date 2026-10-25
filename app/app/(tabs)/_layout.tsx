import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useReview } from "../../src/api/hooks";
import { colors } from "../../src/theme";

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => (
  <Text style={{ color, fontSize: 18 }}>{glyph}</Text>
);

export default function TabsLayout() {
  const review = useReview();
  const count = review.data?.length ?? 0;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Friends", tabBarIcon: icon("●") }} />
      <Tabs.Screen
        name="review"
        options={{
          title: "Review",
          tabBarIcon: icon("✓"),
          tabBarBadge: count > 0 ? count : undefined,
        }}
      />
    </Tabs>
  );
}
