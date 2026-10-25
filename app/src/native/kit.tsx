import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type ComponentRef,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { BlurTargetView, BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCents } from "../format";

export const palette = {
  bg: "#f9f4ef",
  ink: "#382b28",
  muted: "#a08b80",
  accent: "#b94c43",
  line: "#eee2d9",
};
export type NativeBlurTarget = RefObject<ComponentRef<typeof View> | null>;
export const BlurTargetContext = createContext<
  | {
      target: NativeBlurTarget | undefined;
      setTarget: (target: NativeBlurTarget) => void;
    }
  | undefined
>(undefined);
export function NativeCanvas({ children }: { children: ReactNode }) {
  const local = useRef<ComponentRef<typeof View> | null>(null);
  const setTarget = useContext(BlurTargetContext)?.setTarget;
  useFocusEffect(
    useCallback(() => {
      setTarget?.(local);
    }, [setTarget]),
  );
  return (
    <BlurTargetView ref={local} style={{ flex: 1 }}>
      {children}
    </BlurTargetView>
  );
}
export const nativeStyles = StyleSheet.create({
  title: {
    fontFamily: "Poppins",
    fontSize: 24,
    letterSpacing: -0.7,
    color: palette.ink,
  },
  body: { fontFamily: "Inter", color: palette.ink, fontSize: 12 },
  caption: {
    fontFamily: "Inter",
    color: palette.muted,
    fontSize: 10,
    lineHeight: 16,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
});
const art = [
  require("../../assets/avatars/1f98a.png"),
  require("../../assets/avatars/1f43c.png"),
  require("../../assets/avatars/1f428.png"),
  require("../../assets/avatars/1f427.png"),
];
const backgrounds = ["#f5e9dc", "#f2e9e8", "#e1ece6", "#f2e5e3"];
export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  const known = ["Sam", "Jordan", "Alex", "Riley"].indexOf(name);
  const index = known < 0
    ? Array.from(name).reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4
    : known;
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: backgrounds[index],
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: "#ffffffc9",
      }}
    >
      <Image
        source={art[index]}
        style={{ width: size * 0.73, height: size * 0.73 }}
        resizeMode="contain"
      />
    </View>
  );
}
export function Icon({
  name,
  size = 22,
  color = palette.ink,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const names: Record<
    string,
    React.ComponentProps<typeof MaterialIcons>["name"]
  > = {
    home: "home",
    edit: "edit",
    user: "person-outline",
    people: "people-outline",
    grid: "account-balance-wallet",
    review: "fact-check",
    payback: "swap-horiz",
    events: "event-note",
    arrow: "arrow-forward",
    back: "arrow-back",
    search: "search",
    download: "file-download",
    check: "check",
    close: "close",
    chevron: "chevron-right",
  };
  return (
    <MaterialIcons
      accessible={false}
      name={names[name] ?? "chevron-right"}
      size={size}
      color={color}
    />
  );
}
export function Money({
  cents,
  light = false,
}: {
  cents: number;
  light?: boolean;
}) {
  const value = formatCents(cents);
  return (
    <Text>
      {value.slice(0, -3)}
      <Text
        style={{ fontFamily: "Inter", color: light ? "#ffffffa6" : "#a98b86" }}
      >
        {value.slice(-3)}
      </Text>
    </Text>
  );
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
export function Glass({
  children,
  style,
  blur = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  blur?: boolean;
}) {
  const target = useContext(BlurTargetContext)?.target;
  if (!blur) return <View style={[k.glass, style]}>{children}</View>;
  return (
    <BlurView
      blurTarget={target}
      blurMethod="dimezisBlurViewSdk31Plus"
      intensity={35}
      tint="light"
      style={[k.glass, style]}
    >
      {children}
    </BlurView>
  );
}
export type SelectorOption = {
  key: string;
  label: string;
  icon?: string;
  badge?: number;
};
export function Selector({
  options,
  index,
  onSelect,
  navigation = false,
}: {
  options: SelectorOption[];
  index: number;
  onSelect: (index: number) => void;
  navigation?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const position = useRef(new Animated.Value(index)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    const animation = Animated.timing(position, {
      toValue: index,
      duration: reduced ? 0 : 260,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [index, reduced, position]);
  const itemWidth = Math.max(0, (width - 10) / options.length);
  return (
    <Glass blur={navigation} style={[k.selector, navigation && k.navigation]}>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={k.selectorInner}
      >
        {width > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              k.highlight,
              {
                width: itemWidth,
                transform: [
                  { translateX: Animated.multiply(position, itemWidth) },
                ],
              },
            ]}
          />
        )}
        {options.map((option, i) => (
          <Pressable
            accessibilityRole={navigation ? "tab" : "button"}
            accessibilityLabel={option.label}
            accessibilityState={{ selected: i === index }}
            key={option.key}
            onPress={() => onSelect(i)}
            style={[k.selectorButton, navigation && k.navButton]}
          >
            {option.icon && (
              <Icon
                name={option.icon}
                size={21}
                color={i === index ? "#a95749" : "#ac9490"}
              />
            )}
            <Text style={[k.selectorText, i === index && k.selectedText]}>
              {option.label}
            </Text>
            {!!option.badge && <Text style={k.badge}>{option.badge}</Text>}
          </Pressable>
        ))}
      </View>
    </Glass>
  );
}
export function Action({
  title,
  onPress,
  disabled = false,
  secondary = false,
  large = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  large?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        k.action,
        large && { minHeight: 48 },
        secondary && k.secondary,
        disabled && k.disabled,
        pressed && !disabled && { opacity: 0.8 },
      ]}
    >
      <Text
        style={[
          k.actionText,
          large && { fontSize: 14 },
          secondary && { color: "#b19792" },
          disabled && { color: "#c5afab" },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Header({
  onAccount,
  light = true,
  title,
}: {
  onAccount: () => void;
  light?: boolean;
  title?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[k.header, { paddingTop: insets.top + 25 }]}>
      {/* Screen title only; no app name, so screens read as an app rather than a website. */}
      <Text style={[k.brand, !light && { color: palette.ink }, { fontSize: 32 }]}>
        {title ?? ''}
        {process.env.EXPO_PUBLIC_DEMO === "1" && <Text style={{ fontFamily: "Inter", fontSize: 9, color: light ? "#fae7e4" : palette.muted }}>  · Demo data</Text>}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open account"
        onPress={onAccount}
        style={({ pressed }) => ({
          transform: [{ scale: pressed ? 0.94 : 1 }],
        })}
      >
        <Avatar name="Account" size={38} />
      </Pressable>
    </View>
  );
}
export function WarmSurface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <LinearGradient
      colors={["#a63f39", "#c96b57", "#dda187"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
export function Sheet({
  visible,
  onClose,
  children,
  label,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (visible) setMounted(true);
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduced ? 0 : visible ? 250 : 180,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [visible, reduced, progress]);
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={k.modal}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
          <Pressable
            style={k.backdrop}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close details"
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={label}
          style={[
            k.sheet,
            {
              paddingBottom: Math.max(22, insets.bottom),
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [50, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            <View style={k.handle} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close details"
              onPress={onClose}
              style={k.close}
            >
              <Icon name="close" size={20} color="#a48984" />
            </Pressable>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
export function Details({
  name,
  caption,
  balance,
  rows,
  onClose,
  onActivity,
}: {
  name: string;
  caption: string;
  balance: number;
  rows: [string, string][];
  onClose: () => void;
  onActivity?: () => void;
}) {
  return (
    <>
      <View style={nativeStyles.row}>
        <Avatar name={name} size={48} />
        <View style={{ flex: 1, paddingRight: 28 }}>
          <Text style={k.eyebrow}>
            {onActivity ? "FRIEND DETAILS" : "ACCOUNT"}
          </Text>
          <Text style={k.personName}>{name}</Text>
        </View>
      </View>
      <WarmSurface style={k.balancePanel}>
        <Text style={k.balanceCaption}>{caption}</Text>
        <Text style={k.balanceAmount}>
          <Money cents={balance} light />
        </Text>
      </WarmSurface>
      <View style={k.detailRows}>
        {rows.map(([label, value]) => (
          <View key={label} style={k.detailRow}>
            <Text style={nativeStyles.caption}>{label}</Text>
            <Text style={nativeStyles.body}>{value}</Text>
          </View>
        ))}
      </View>
      <Text style={[nativeStyles.caption, { marginVertical: 14 }]}>
        Includes confirmed and estimated activity.
      </Text>
      {onActivity && (
        <View style={{ marginBottom: 8 }}>
          <Action title="View shared activity" onPress={onActivity} />
        </View>
      )}
      <Action title="Done" onPress={onClose} secondary={!!onActivity} />
    </>
  );
}
const k = StyleSheet.create({
  glass: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ffffffdd",
    backgroundColor: "#fbedea73",
    borderRadius: 30,
  },
  selector: { padding: 0 },
  navigation: {
    width: 290,
    shadowColor: "#70473f",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 3,
  },
  selectorInner: { flexDirection: "row", padding: 5, position: "relative" },
  highlight: {
    position: "absolute",
    left: 5,
    top: 5,
    bottom: 5,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "#fff",
    backgroundColor: "#ffffffaa",
  },
  selectorButton: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
  },
  navButton: { minHeight: 46 },
  selectorText: { fontFamily: "InterMedium", fontSize: 11, color: "#ad948f" },
  selectedText: { color: "#a95749" },
  badge: {
    fontFamily: "Inter",
    fontSize: 9,
    color: "#ad776d",
    backgroundColor: "#d7897b1f",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 10,
  },
  action: {
    height: 42,
    backgroundColor: palette.accent,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { fontFamily: "InterMedium", fontSize: 12, color: "#fff" },
  secondary: {
    backgroundColor: "#f8f1f0",
    borderWidth: 1,
    borderColor: "#f3e7e4",
  },
  disabled: { backgroundColor: "#f6eeec" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  brand: {
    fontFamily: "Poppins",
    fontSize: 17,
    letterSpacing: -0.5,
    color: "#fff",
  },
  modal: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 12 },
  backdrop: { flex: 1, backgroundColor: "#3e201b70" },
  sheet: {
    maxHeight: "88%",
    padding: 23,
    paddingTop: 12,
    marginBottom: 12,
    borderRadius: 30,
    backgroundColor: "#fefaf9",
    borderWidth: 1,
    borderColor: "#ffffffdd",
  },
  handle: {
    width: 31,
    height: 4,
    borderRadius: 5,
    backgroundColor: "#dececb",
    alignSelf: "center",
    marginBottom: 24,
  },
  close: {
    position: "absolute",
    right: 0,
    top: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#f4ebea",
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    fontFamily: "InterMedium",
    fontSize: 8,
    letterSpacing: 1.5,
    color: "#b69d98",
    marginBottom: 5,
  },
  personName: { fontFamily: "Poppins", fontSize: 22, color: palette.ink },
  balancePanel: {
    borderRadius: 21,
    padding: 20,
    marginTop: 22,
    marginBottom: 14,
  },
  balanceCaption: { fontFamily: "Inter", fontSize: 11, color: "#f9e2de" },
  balanceAmount: {
    fontFamily: "InterMedium",
    fontSize: 39,
    letterSpacing: -1.6,
    color: "#fff",
    marginTop: 6,
  },
  detailRows: {
    paddingHorizontal: 15,
    borderRadius: 18,
    backgroundColor: "#fff",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: palette.line,
    paddingVertical: 13,
  },
});
