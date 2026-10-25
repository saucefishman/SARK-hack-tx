import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { FriendSummary } from '@sark/shared';
import { formatCents } from '../format';
import { CENTRE_RADIUS, layoutStar, NODE_RADIUS, type Flow, type StarNode } from './constellation-layout';
import { Avatar, palette, useReducedMotion } from './kit';

// Home-screen summary: you in the middle, each friend on a ring. A line per friend, thicker for a bigger balance, with dots
// travelling toward whoever is owed. The friend you owe pulses. No chart library: plain Views and Animated.
const OWE = { solid: '#b94c43', line: 'rgba(185,76,67,0.30)' }; // you owe them
const OWED = { solid: '#5f9473', line: 'rgba(95,148,115,0.30)' }; // they owe you
const DOT = 6;

/** Loops 0 -> 1 forever after `delay` ms. Parked at 0.5 (a visible, still frame) when disabled. */
function useLoop(enabled: boolean, delay: number, duration: number) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) {
      v.setValue(0.5);
      return;
    }
    v.setValue(0);
    let loop: Animated.CompositeAnimation | undefined;
    const t = setTimeout(() => {
      loop = Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
      loop.start();
    }, delay);
    return () => {
      clearTimeout(t);
      loop?.stop();
    };
  }, [enabled, delay, duration, v]);
  return v;
}

function FlowDot({ length, thickness, flow, animate, delay }: { length: number; thickness: number; flow: Flow; animate: boolean; delay: number }) {
  const v = useLoop(animate, delay, 2100);
  const color = flow === 'toThem' ? OWE.solid : OWED.solid;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -DOT / 2,
        top: thickness / 2 - DOT / 2,
        width: DOT,
        height: DOT,
        borderRadius: DOT / 2,
        backgroundColor: color,
        opacity: v.interpolate({ inputRange: [0, 0.12, 0.88, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: flow === 'toThem' ? [0, length] : [length, 0] }) }],
      }}
    />
  );
}

function Edge({ node, animate }: { node: StarNode; animate: boolean }) {
  const { mx, my, length, thickness, angleDeg } = node.edge;
  if (node.flow === 'even' || length <= 0) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: mx - length / 2,
        top: my - thickness / 2,
        width: length,
        height: thickness,
        borderRadius: thickness / 2,
        backgroundColor: node.flow === 'toThem' ? OWE.line : OWED.line,
        transform: [{ rotate: `${angleDeg}deg` }],
      }}
    >
      {[0, 700, 1400].map((delay) => (
        <FlowDot key={delay} length={length} thickness={thickness} flow={node.flow} animate={animate} delay={delay} />
      ))}
    </View>
  );
}

function Pulse({ animate }: { animate: boolean }) {
  const v = useLoop(animate, 0, 1700);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: NODE_RADIUS * 2 + 4,
        height: NODE_RADIUS * 2 + 4,
        borderRadius: NODE_RADIUS + 2,
        borderWidth: 2,
        borderColor: OWE.solid,
        opacity: animate ? v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }) : 0.35,
        transform: [{ scale: animate ? v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) : 1 }],
      }}
    />
  );
}

const status = (b: number) => (b < 0 ? `Your turn · ${formatCents(-b)}` : b > 0 ? `Their turn · ${formatCents(b)}` : 'Even');

export function Constellation({ friends, onSelect }: { friends: FriendSummary[]; onSelect: (id: string) => void }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const size = Math.max(260, Math.min(360, width - 40));
  const { nodes, hidden, centre } = layoutStar(friends, size);
  if (!nodes.length) return null;
  return (
    <View>
      <View style={[s.field, { width: size, height: size }]}>
        {nodes.map((n) => <Edge key={`edge:${n.id}`} node={n} animate={!reduced} />)}
        <View style={[s.centre, { left: centre.x - CENTRE_RADIUS, top: centre.y - CENTRE_RADIUS }]} accessible={false}>
          <Text style={s.centreText}>You</Text>
        </View>
        {nodes.map((n) => (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            accessibilityLabel={`${n.name}. ${status(n.balanceCents)}`}
            onPress={() => onSelect(n.id)}
            style={({ pressed }) => [s.node, { left: n.x - 44, top: n.y - NODE_RADIUS, opacity: pressed ? 0.75 : 1 }]}
          >
            <View style={s.avatarWrap}>
              {n.flow === 'toThem' && <Pulse animate={!reduced} />}
              <View style={n.flow === 'even' ? s.evenGlow : undefined}>
                <Avatar name={n.name} size={NODE_RADIUS * 2} />
              </View>
            </View>
            <Text style={s.name} numberOfLines={1}>{n.name}</Text>
            <Text style={[s.status, n.flow === 'toThem' && { color: OWE.solid }, n.flow === 'toYou' && { color: OWED.solid }]} numberOfLines={1}>{status(n.balanceCents)}</Text>
          </Pressable>
        ))}
      </View>
      {hidden > 0 && <Text style={s.more}>+{hidden} more in your detailed summary</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  field: { alignSelf: 'center', position: 'relative' },
  centre: { position: 'absolute', width: CENTRE_RADIUS * 2, height: CENTRE_RADIUS * 2, borderRadius: CENTRE_RADIUS, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  centreText: { fontFamily: 'Poppins', fontSize: 13, color: '#fff' },
  node: { position: 'absolute', width: 88, alignItems: 'center' },
  avatarWrap: { width: NODE_RADIUS * 2 + 4, height: NODE_RADIUS * 2 + 4, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  evenGlow: { borderRadius: NODE_RADIUS + 4, padding: 2, backgroundColor: '#dcebe1' },
  name: { fontFamily: 'Poppins', fontSize: 12, color: palette.ink, marginTop: 4 },
  status: { fontFamily: 'InterMedium', fontSize: 9, color: palette.muted, marginTop: 1 },
  more: { fontFamily: 'Inter', fontSize: 11, color: palette.muted, textAlign: 'center', marginTop: 4 },
});
