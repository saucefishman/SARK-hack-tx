import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFonts } from "expo-font";
import { colors } from "../src/theme";

export default function RootLayout() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }),
  );
  const [fontsLoaded, fontError] = useFonts({
    ...MaterialIcons.font,
    Poppins: require("../assets/fonts/Poppins-500.ttf"),
    Inter: require("../assets/fonts/Inter-400.ttf"),
    InterMedium: require("../assets/fonts/Inter-500.ttf"),
    InterSemiBold: require("../assets/fonts/Inter-600.ttf"),
    InterBold: require("../assets/fonts/Inter-700.ttf"),
  });
  if (!fontsLoaded && !fontError) return null;
  return (
    <QueryClientProvider client={client}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="friends/[id]"
          options={{ title: "Friend", headerBackTitle: "Back" }}
        />
      </Stack>
    </QueryClientProvider>
  );
}
