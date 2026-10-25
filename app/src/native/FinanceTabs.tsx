import { useState } from "react";
import { Tabs } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BlurTargetContext,
  type NativeBlurTarget,
  Selector,
  palette,
} from "./kit";
const tabs: Record<string, { label: string; icon: string }> = {
  index: { label: "Home", icon: "home" },
  events: { label: "Events", icon: "events" },
  people: { label: "Friends", icon: "people" },
};

export default function FinanceTabs() {
  const insets = useSafeAreaInsets();
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
                label: tabs[route.name]?.label ?? route.name,
                icon: tabs[route.name]?.icon ?? "events",
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
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="events" options={{ title: "Events" }} />
        <Tabs.Screen name="people" options={{ title: "Friends" }} />
      </Tabs>
    </BlurTargetContext.Provider>
  );
}
