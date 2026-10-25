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
                label: route.name === "events" ? "Events" : "Friends",
                icon: route.name === "events" ? "events" : "people",
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
        <Tabs.Screen name="index" options={{ title: "Friends" }} />
        <Tabs.Screen name="events" options={{ title: "Events" }} />
      </Tabs>
    </BlurTargetContext.Provider>
  );
}
