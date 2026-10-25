import { useState } from "react";
import { Tabs } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReview } from "../api/hooks";
import {
  BlurTargetContext,
  type NativeBlurTarget,
  Selector,
  palette,
} from "./kit";
export default function FinanceTabs() {
  const insets = useSafeAreaInsets();
  const review = useReview();
  const [target, setTarget] = useState<NativeBlurTarget | undefined>(undefined);
  return (
    <BlurTargetContext.Provider value={{ target, setTarget }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: palette.bg },
        }}
        tabBar={({ state, emitter, navigateToTab }) => (
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: Math.max(insets.bottom, 16),
              alignItems: "center",
            }}
          >
            <Selector
              navigation
              index={state.index}
              options={state.routes.map((route) => ({
                key: route.key,
                label: route.name === "review" ? "Review" : "Overview",
                icon: route.name === "review" ? "review" : "grid",
                badge:
                  route.name === "review" ? review.data?.length : undefined,
              }))}
              onSelect={(index) => {
                const route = state.routes[index];
                const event = emitter.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!event.defaultPrevented) navigateToTab(route.key);
              }}
            />
          </View>
        )}
      >
        <Tabs.Screen name="index" options={{ title: "Overview" }} />
        <Tabs.Screen name="review" options={{ title: "Review" }} />
      </Tabs>
    </BlurTargetContext.Provider>
  );
}
