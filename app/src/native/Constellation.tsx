import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { FriendSummary } from '@sark/shared';
import { formatCents } from '../format';
import { AVATAR_BOX, CENTRE_RADIUS, LABEL_HALF_WIDTH, layoutStar, NODE_BOX, NODE_RADIUS, type Flow, type StarNode } from './constellation-layout';
import { Avatar, palette, useReducedMotion } from './kit';

// Home-screen summary: you in the middle, each friend on an orbit. A glowing line per friend, thicker for a bigger balance,
// with dots travelling toward whoever is owed. The friend you owe pulses. No chart library: plain Views and Animated.
const OWE = { solid: '#b94c43', line: 'rgba(185,76,67,0.34)', glow: 'rgba(185,76,67,0.10)', tint: 'rgba(185,76,67,0.10)' };
const OWED = { solid: '#5f9473', line: 'rgba(95,148,115,0.34)', glow: 'rgba(95,148,115,0.10)', tint: 'rgba(95,148,115,0.12)' };
const ORBIT = 'rgba(160,139,128,0.22)';
const DOT = 6;
const HALO = 14;

/** Loops 0 -> 1 forever after `delay` ms. Parked at 0.5 (a visible, still frame) when disabled. */
function useLoop(enabled: boolean, delay: number, duration: number) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) {
      v.setValue(0.5);
      return;
    }
    v.setValue(0);
    // Restart by hand rather than Animated.loop, which stops after one pass on web.
    let alive = true;
    const run = () => {
      v.setValue(0);
      Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }).start(({ finished }) => {
        if (alive && finished) run();
      });
    };
    const t = setTimeout(run, delay);
    return () => {
      alive = false;
      clearTimeout(t);
      v.stopAnimation();
    };
  }, [enabled, delay, duration, v]);
  return v;
}

/** Deterministic sprinkle of background stars so the field looks the same every render. */
function sprinkle(size: number, height: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const r = (n: number) => {
      const x = Math.sin((i + 1) * n) * 43758.5453;
      return x - Math.floor(x);
    };
    return { x: 8 + r(12.9898) * (size - 16), y: 8 + r(78.233) * (height - 16), s: 2 + Math.round(r(39.346) * 2), twinkle: i % 3 === 0, delay: Math.round(r(11.135) * 2400) };
  });
}

function Twinkle({ x, y, s, animate, delay }: { x: number; y: number; s: number; animate: boolean; delay: number }) {
  const v = useLoop(animate, delay, 2800);
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: x, top: y, width: s, height: s, borderRadius: s / 2, backgroundColor: '#c9a99b', opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.12, 0.65, 0.12] }) }}
    />
  );
}

function Orbit({ cx, cy, r, dashed }: { cx: number; cy: number; r: number; dashed?: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: cx - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: r, borderWidth: 1, borderColor: ORBIT, borderStyle: dashed ? 'dashed' : 'solid' }}
    />
  );
}

/** Soft glow behind "You" that breathes slowly. */
function CentreGlow({ cx, cy, animate }: { cx: number; cy: number; animate: boolean }) {
  const v = useLoop(animate, 0, 3600);
  const scale = animate ? v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.14, 1] }) : 1;
  return (
    <>
      {[{ r: 62, a: 0.06 }, { r: 48, a: 0.09 }].map(({ r, a }) => (
        <Animated.View
          key={r}
          pointerEvents="none"
          style={{ position: 'absolute', left: cx - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: `rgba(185,76,67,${a})`, transform: [{ scale }] }}
        />
      ))}
    </>
  );
}

function FlowDot({ length, thickness, flow, animate, delay }: { length: number; thickness: number; flow: Flow; animate: boolean; delay: number }) {
  const v = useLoop(animate, delay, 2300);
  const c = flow === 'toThem' ? OWE : OWED;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -HALO / 2,
        top: thickness / 2 - HALO / 2,
        width: HALO,
        height: HALO,
        borderRadius: HALO / 2,
        backgroundColor: c.glow,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: v.interpolate({ inputRange: [0, 0.12, 0.88, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: flow === 'toThem' ? [0, length] : [length, 0] }) }],
      }}
    >
      <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: c.solid }} />
    </Animated.View>
  );
}

function Edge({ node, animate }: { node: StarNode; animate: boolean }) {
  const { mx, my, length, thickness, angleDeg } = node.edge;
  if (node.flow === 'even' || length <= 0) return null;
  const c = node.flow === 'toThem' ? OWE : OWED;
  const glow = thickness + 6;
  const common = { position: 'absolute', left: mx - length / 2, width: length, transform: [{ rotate: `${angleDeg}deg` }] } as const;
  return (
    <>
      <View pointerEvents="none" style={{ ...common, top: my - glow / 2, height: glow, borderRadius: glow / 2, backgroundColor: c.glow }} />
      <View pointerEvents="none" style={{ ...common, top: my - thickness / 2, height: thickness, borderRadius: thickness / 2, backgroundColor: c.line }}>
        {[0, 760, 1520].map((delay) => (
          <FlowDot key={delay} length={length} thickness={thickness} flow={node.flow} animate={animate} delay={delay} />
        ))}
      </View>
    </>
  );
}

function Pulse({ animate }: { animate: boolean }) {
  const v = useLoop(animate, 0, 1800);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: NODE_RADIUS * 2 + 8,
        height: NODE_RADIUS * 2 + 8,
        borderRadius: NODE_RADIUS + 4,
        borderWidth: 2,
        borderColor: OWE.solid,
        opacity: animate ? v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }) : 0.35,
        transform: [{ scale: animate ? v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) : 1 }],
      }}
    />
  );
}

/** Two short lines in a pill: "Your turn" over "$94.66". Nothing here is wide enough to be cut off with an ellipsis. */
function Chip({ balance }: { balance: number }) {
  const c = balance < 0 ? OWE : balance > 0 ? OWED : null;
  return (
    <View style={[s.chip, { backgroundColor: c ? c.tint : 'rgba(160,139,128,0.14)' }]}>
      <Text style={[s.chipTop, { color: c ? c.solid : palette.muted }]}>{balance < 0 ? 'Your turn' : balance > 0 ? 'Their turn' : 'All even'}</Text>
      {balance !== 0 && <Text style={[s.chipAmount, { color: c!.solid }]}>{formatCents(Math.abs(balance))}</Text>}
    </View>
  );
}

const spoken = (n: StarNode) => `${n.name}. ${n.balanceCents < 0 ? `Your turn, ${formatCents(-n.balanceCents)}` : n.balanceCents > 0 ? `Their turn, ${formatCents(n.balanceCents)}` : 'Even'}`;

export function Constellation({ friends, onSelect }: { friends: FriendSummary[]; onSelect: (id: string) => void }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const size = Math.max(260, Math.min(360, width - 40));
  const { nodes, hidden, centre, ring, height } = layoutStar(friends, size);
  const stars = useMemo(() => sprinkle(size, height, 18), [size, height]);
  if (!nodes.length) return null;
  return (
    <View>
      <View style={[s.field, { width: size, height }]}>
        {stars.map((st, i) => <Twinkle key={i} x={st.x} y={st.y} s={st.s} animate={!reduced && st.twinkle} delay={st.delay} />)}
        <Orbit cx={centre.x} cy={centre.y} r={ring * 0.52} />
        <Orbit cx={centre.x} cy={centre.y} r={ring} dashed />
        <Orbit cx={centre.x} cy={centre.y} r={ring + 36} />
        <CentreGlow cx={centre.x} cy={centre.y} animate={!reduced} />
        {nodes.map((n) => <Edge key={`edge:${n.id}`} node={n} animate={!reduced} />)}
        <View style={[s.centre, { left: centre.x - CENTRE_RADIUS, top: centre.y - CENTRE_RADIUS }]} accessible={false}>
          <Text style={s.centreText}>You</Text>
        </View>
        {nodes.map((n) => {
          const c = n.flow === 'toThem' ? OWE : n.flow === 'toYou' ? OWED : null;
          return (
            <Pressable
              key={n.id}
              accessibilityRole="button"
              accessibilityLabel={spoken(n)}
              onPress={() => onSelect(n.id)}
              style={({ pressed }) => [s.node, { left: n.x - LABEL_HALF_WIDTH, top: n.labelAbove ? n.y + AVATAR_BOX / 2 - NODE_BOX : n.y - AVATAR_BOX / 2, flexDirection: n.labelAbove ? 'column-reverse' : 'column', opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] }]}
            >
              <View style={s.avatarWrap}>
                {n.flow === 'toThem' && <Pulse animate={!reduced} />}
                <View style={[s.avatarRing, { borderColor: c ? c.solid : '#cfe0d5', backgroundColor: c ? c.tint : '#e4efe8' }]}>
                  <Avatar name={n.name} size={NODE_RADIUS * 2 - 2} />
                </View>
              </View>
              <Text style={s.name} numberOfLines={1}>{n.name}</Text>
              <Chip balance={n.balanceCents} />
            </Pressable>
          );
        })}
      </View>
      {hidden > 0 && <Text style={s.more}>+{hidden} more in your detailed summary</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  field: { alignSelf: 'center', position: 'relative' },
  centre: {
    position: 'absolute',
    width: CENTRE_RADIUS * 2,
    height: CENTRE_RADIUS * 2,
    borderRadius: CENTRE_RADIUS,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#f3d9d2',
  },
  centreText: { fontFamily: 'Poppins', fontSize: 13, color: '#fff' },
  node: { position: 'absolute', width: LABEL_HALF_WIDTH * 2, height: NODE_BOX, alignItems: 'center', justifyContent: 'flex-start' },
  avatarWrap: { width: AVATAR_BOX, height: AVATAR_BOX, alignItems: 'center', justifyContent: 'center' },
  avatarRing: { width: NODE_RADIUS * 2 + 4, height: NODE_RADIUS * 2 + 4, borderRadius: NODE_RADIUS + 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: 'Poppins', fontSize: 12, color: palette.ink, marginTop: 2, maxWidth: LABEL_HALF_WIDTH * 2 },
  chip: { marginTop: 3, borderRadius: 11, paddingHorizontal: 8, paddingVertical: 3, alignItems: 'center' },
  chipTop: { fontFamily: 'InterMedium', fontSize: 9, lineHeight: 12 },
  chipAmount: { fontFamily: 'InterSemiBold', fontSize: 11, lineHeight: 14 },
  more: { fontFamily: 'Inter', fontSize: 11, color: palette.muted, textAlign: 'center', marginTop: 4 },
});
