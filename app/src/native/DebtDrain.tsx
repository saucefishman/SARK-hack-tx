import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { usePayback } from '../api/hooks';
import { formatCents, formatDate } from '../format';
import { drainSteps, type Drain } from './debt-drain';
import { Action, palette, useReducedMotion } from './kit';
import { remainingBalance } from './payback-presentation';

// Per-person: the best plan from the payback API, played as a bar draining stop by stop until the user is even.
// One `progress` value (0 = full debt, 1 = last stop) drives the whole animation. With `scroll` it follows the
// page's scroll position; without it (or when the page can't scroll far enough) it plays on a timer.
// Renders nothing unless the user owes this friend and at least one plan exists.
const GREEN = '#5f9473';
const AMBER = '#d4a24c';
const RED = palette.accent;
const BURST = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * 2 * Math.PI;
  return { dx: Math.cos(a) * (46 + (i % 3) * 14), dy: Math.sin(a) * (30 + (i % 3) * 10), color: [RED, GREEN, AMBER][i % 3]! };
});
const DRAIN_SHARE = 0.75; // of each stop's slice of progress, spent draining; the rest holds before the next stop

/** Scroll state of the page the card sits in. `offset` is the y of the card's parent inside the scroll content. */
export interface DrainScroll {
  y: Animated.Value;
  viewport: number;
  content: number;
  offset: number;
}

// Piecewise progress -> cents still owed: each stop drains, then holds.
function curve(drain: Drain, debt: number) {
  const n = drain.steps.length;
  if (!n) return { input: [0, 1], output: [debt, debt] };
  const input = [0];
  const output = [debt];
  drain.steps.forEach((step, i) => {
    input.push((i + DRAIN_SHARE) / n, (i + 1) / n);
    output.push(step.remainingCents, step.remainingCents);
  });
  return { input, output };
}

function owedAt(c: { input: number[]; output: number[] }, t: number) {
  for (let i = 1; i < c.input.length; i++) {
    if (t <= c.input[i]!) {
      const a = c.input[i - 1]!, b = c.input[i]!;
      const k = 1 - (1 - (t - a) / (b - a)) ** 3; // ease-out within a stop
      return c.output[i - 1]! + (c.output[i]! - c.output[i - 1]!) * k;
    }
  }
  return c.output[c.output.length - 1]!;
}

export function DebtDrain({ id, name, scroll }: { id: string; name: string; scroll?: DrainScroll }) {
  const q = usePayback(id);
  const reduced = useReducedMotion();
  const [planIndex, setPlanIndex] = useState(0);
  const plans = q.data?.suggestions ?? [];
  const debt = q.data?.debtCents ?? 0;
  const plan = plans.length ? plans[planIndex % plans.length] : undefined;
  const drain = useMemo(() => (plan ? drainSteps(plan, debt) : null), [plan, debt]);
  const c = useMemo(() => (drain ? curve(drain, debt) : null), [drain, debt]);

  const [box, setBox] = useState({ y: 0, h: 0 });
  // Scroll window: starts once the card's top is ~60% down the screen, ends ~65% of a card-height later (or at the page end).
  const range = useMemo(() => {
    if (!scroll || !box.h) return null;
    const start = Math.max(0, scroll.offset + box.y - scroll.viewport * 0.6);
    const end = Math.min(start + box.h * 0.65, scroll.content - scroll.viewport);
    return end - start > 40 ? { start, end } : null;
  }, [scroll?.offset, scroll?.viewport, scroll?.content, box]);
  const scrolled = !!range && !reduced;

  const timer = useRef(new Animated.Value(0)).current;
  const progress = useMemo(
    () => (scrolled ? scroll!.y.interpolate({ inputRange: [range!.start, range!.end], outputRange: [0, 1], extrapolate: 'clamp' }) : timer.interpolate({ inputRange: [0, 1], outputRange: [0, 1] })),
    [scrolled, scroll?.y, range, timer],
  );
  const remaining = useMemo(
    () => progress.interpolate(c ? { inputRange: c.input, outputRange: c.output, easing: Easing.out(Easing.cubic) } : { inputRange: [0, 1], outputRange: [debt, debt] }),
    [c, progress],
  );

  const burst = useRef(new Animated.Value(0)).current;
  const [t, setT] = useState(0);
  const done = t >= 0.999;
  useEffect(() => {
    const sub = progress.addListener(({ value }) => setT(value));
    return () => progress.removeListener(sub);
  }, [progress]);
  useEffect(() => {
    if (done && drain?.settled) Animated.timing(burst, { toValue: 1, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    else burst.setValue(0);
  }, [done, drain?.settled, burst]);

  const play = useCallback(() => {
    if (!drain) return;
    timer.stopAnimation();
    if (reduced) return timer.setValue(1);
    timer.setValue(0);
    Animated.timing(timer, { toValue: 1, duration: 1180 * drain.steps.length, delay: 500, easing: Easing.linear, useNativeDriver: false }).start();
  }, [drain, reduced, timer]);

  // Timed mode: play once whenever a different plan (or debt) shows up; a refetch of the same plan does not restart it.
  // With a scroll page, wait until the card is measured so it doesn't start a timer it would drop a frame later.
  const signature = plan && !scrolled && (!scroll || box.h) ? `${plan.id}:${debt}:${reduced}` : '';
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    if (!signature) return;
    playRef.current();
    return () => timer.stopAnimation();
  }, [signature, timer]);

  if (!plan || !drain || debt <= 0) return null;

  const fillWidth = remaining.interpolate({ inputRange: [0, debt], outputRange: ['0%', '100%'], extrapolate: 'clamp' });
  const fillColor = remaining.interpolate({ inputRange: [0, debt / 2, debt], outputRange: [GREEN, AMBER, RED], extrapolate: 'clamp' });
  const even = done && drain.settled;
  const shown = Math.round(owedAt(c!, t));
  const active = Math.min(drain.steps.length - 1, Math.floor(t * drain.steps.length + 1e-6)) - (t > 0 ? 0 : 1);

  return (
    <View style={s.card} onLayout={(e) => setBox({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}>
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
        {/* Action is a full-width block with no side padding; each cell gives it an equal share of the row to fill. */}
        {!scrolled && <View style={s.actionCell}><Action title="Replay" secondary onPress={play} /></View>}
        {plans.length > 1 && <View style={s.actionCell}><Action title="Another plan" secondary onPress={() => setPlanIndex((i) => i + 1)} /></View>}
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
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionCell: { flex: 1, minWidth: 0 },
});
