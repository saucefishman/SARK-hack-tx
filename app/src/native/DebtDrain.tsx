import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { usePayback } from '../api/hooks';
import { formatCents, formatDate } from '../format';
import { drainSteps } from './debt-drain';
import { Action, palette, useReducedMotion } from './kit';
import { remainingBalance } from './payback-presentation';

// Per-person: the best plan from the payback API, played as a bar draining stop by stop until the user is even.
// Renders nothing unless the user owes this friend and at least one plan exists.
const GREEN = '#5f9473';
const AMBER = '#d4a24c';
const RED = palette.accent;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const BURST = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * 2 * Math.PI;
  return { dx: Math.cos(a) * (46 + (i % 3) * 14), dy: Math.sin(a) * (30 + (i % 3) * 10), color: [RED, GREEN, AMBER][i % 3]! };
});

export function DebtDrain({ id, name }: { id: string; name: string }) {
  const q = usePayback(id);
  const reduced = useReducedMotion();
  const [planIndex, setPlanIndex] = useState(0);
  const plans = q.data?.suggestions ?? [];
  const debt = q.data?.debtCents ?? 0;
  const plan = plans.length ? plans[planIndex % plans.length] : undefined;
  const drain = useMemo(() => (plan ? drainSteps(plan, debt) : null), [plan, debt]);

  const remaining = useRef(new Animated.Value(debt)).current; // cents still owed; may dip below zero on an overshoot
  const burst = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(debt);
  const [active, setActive] = useState(-1);
  const [done, setDone] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    const sub = remaining.addListener(({ value }) => setShown(Math.round(value)));
    return () => remaining.removeListener(sub);
  }, [remaining]);

  const play = useCallback(async () => {
    if (!drain) return;
    const token = ++run.current;
    remaining.stopAnimation();
    burst.setValue(0);
    setDone(false);
    const finish = () => {
      setDone(true);
      if (drain.settled) Animated.timing(burst, { toValue: 1, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    };
    if (reduced) {
      remaining.setValue(drain.endCents);
      setActive(drain.steps.length - 1);
      finish();
      return;
    }
    remaining.setValue(debt);
    setActive(-1);
    await wait(500);
    for (let i = 0; i < drain.steps.length; i++) {
      if (run.current !== token) return;
      setActive(i);
      await new Promise<void>((resolve) =>
        Animated.timing(remaining, { toValue: drain.steps[i]!.remainingCents, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => resolve()),
      );
      await wait(380);
    }
    if (run.current === token) finish();
  }, [drain, debt, reduced, remaining, burst]);

  // Play once whenever a different plan (or debt) shows up; a refetch of the same plan does not restart it.
  const signature = plan ? `${plan.id}:${debt}:${reduced}` : '';
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    if (!signature) return;
    void playRef.current();
    return () => {
      run.current++;
    };
  }, [signature]);

  if (!plan || !drain || debt <= 0) return null;

  const fillWidth = remaining.interpolate({ inputRange: [0, debt], outputRange: ['0%', '100%'], extrapolate: 'clamp' });
  const fillColor = remaining.interpolate({ inputRange: [0, debt / 2, debt], outputRange: [GREEN, AMBER, RED], extrapolate: 'clamp' });
  const even = done && drain.settled;

  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>HOW YOU GET EVEN</Text>
      <Text style={s.owe}>{even ? `You and ${name}` : `You owe ${name}`}</Text>
      <View style={s.numberRow}>
        <Text style={[s.number, even && { color: GREEN }]}>{even ? 'Even!' : formatCents(Math.max(0, shown))}</Text>
        <View pointerEvents="none" style={s.burstOrigin}>
          {BURST.map((p, i) => (
            <Animated.View
              key={i}
              style={[
                s.particle,
                {
                  backgroundColor: p.color,
                  opacity: burst.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
                  transform: [
                    { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
                    { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy] }) },
                    { scale: burst.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.2, 0.6] }) },
                  ],
                },
              ]}
            />
          ))}
        </View>
      </View>
      <View style={s.track} accessibilityRole="progressbar" accessibilityLabel={`${formatCents(Math.max(0, shown))} left to cover`}>
        <Animated.View style={[s.fill, { width: fillWidth, backgroundColor: fillColor }]} />
      </View>

      <View style={s.stops}>
        {drain.steps.map((step, i) => {
          const reached = i <= active;
          return (
            <View key={step.id} style={[s.stop, !reached && !done && { opacity: 0.5 }]}>
              <View style={s.rail}>
                <View style={[s.dot, reached && s.dotOn]} />
                {i < drain.steps.length - 1 && <View style={[s.line, i < active && s.lineOn]} />}
              </View>
              <View style={{ flex: 1, paddingBottom: 14 }}>
                <Text style={s.stopTitle}>{step.title}</Text>
                <Text style={s.stopMeta}>{step.date ? formatDate(step.date) : 'Sometime soon'}</Text>
              </View>
              <Text style={s.stopAmount}>−{step.amountLabel}</Text>
            </View>
          );
        })}
      </View>

      <Text style={s.result}>{done ? (drain.settled ? `That evens things out with ${name}.` : remainingBalance(plan, debt)) : ' '}</Text>
      <Text style={s.fine}>Prices are estimates.</Text>
      <View style={s.actions}>
        <Action title="Replay" secondary onPress={() => void play()} />
        {plans.length > 1 && <Action title="Another plan" secondary onPress={() => setPlanIndex((i) => i + 1)} />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 24, padding: 22, backgroundColor: '#fffdfb', borderWidth: 1, borderColor: '#eee3dc' },
  eyebrow: { fontFamily: 'InterMedium', fontSize: 9, lineHeight: 16, letterSpacing: 1.15, color: '#a36d5e' },
  owe: { fontFamily: 'Poppins', fontSize: 15, color: palette.ink, marginTop: 10 },
  numberRow: { justifyContent: 'center' },
  number: { fontFamily: 'Poppins', fontSize: 42, lineHeight: 52, letterSpacing: -1.2, color: palette.ink },
  burstOrigin: { position: 'absolute', left: 64, top: 26, width: 0, height: 0 },
  particle: { position: 'absolute', width: 7, height: 7, borderRadius: 4 },
  track: { height: 14, borderRadius: 7, backgroundColor: '#efe6e0', overflow: 'hidden', marginTop: 8 },
  fill: { height: 14, borderRadius: 7 },
  stops: { marginTop: 20 },
  stop: { flexDirection: 'row', gap: 12 },
  rail: { alignItems: 'center', width: 14 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#d9c6bb', backgroundColor: '#fffdfb', marginTop: 3 },
  dotOn: { borderColor: RED, backgroundColor: RED },
  line: { flex: 1, width: 2, backgroundColor: '#eadcd3', marginTop: 2 },
  lineOn: { backgroundColor: RED },
  stopTitle: { fontFamily: 'Poppins', fontSize: 14, lineHeight: 20, color: palette.ink },
  stopMeta: { fontFamily: 'Inter', fontSize: 11, color: palette.muted, marginTop: 1 },
  stopAmount: { fontFamily: 'InterSemiBold', fontSize: 13, color: palette.ink },
  result: { fontFamily: 'InterMedium', fontSize: 12, color: palette.accent, marginTop: 4 },
  fine: { fontFamily: 'Inter', fontSize: 10, color: '#a48a7e', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
});
