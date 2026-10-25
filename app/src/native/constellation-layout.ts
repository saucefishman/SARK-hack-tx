// Geometry for the home-screen "constellation": you in the middle, friends on a ring, one line per friend.
// Pure (no React Native) so it can be checked without a device. Balance sign: positive = friend owes you.
import type { FriendSummary } from '@sark/shared';

export type Flow = 'toYou' | 'toThem' | 'even';

export interface StarNode {
  id: string;
  name: string;
  balanceCents: number;
  /** Node centre. */
  x: number;
  y: number;
  /** Which way money is owed: toThem = you owe them, toYou = they owe you. */
  flow: Flow;
  edge: {
    /** Midpoint of the line, its length, thickness and angle (degrees, from the centre toward the node). */
    mx: number;
    my: number;
    length: number;
    thickness: number;
    angleDeg: number;
  };
}

export interface StarLayout {
  nodes: StarNode[];
  /** Friends left off because the ring only fits `max`. */
  hidden: number;
  centre: { x: number; y: number };
}

export const CENTRE_RADIUS = 27;
export const NODE_RADIUS = 24;
const MIN_LINE = 2;
const MAX_LINE = 8;

/**
 * The `max` friends with the biggest balances, largest at the top, clockwise from there. Line thickness scales with
 * |balance| against the biggest one shown. Friends you are even with get a node but no line length worth drawing.
 */
export function layoutStar(friends: Pick<FriendSummary, 'personId' | 'name' | 'balanceCents'>[], size: number, max = 8): StarLayout {
  const ranked = [...friends].sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents) || a.name.localeCompare(b.name));
  const shown = ranked.slice(0, max);
  const cx = size / 2;
  const cy = size / 2;
  const ring = size * 0.33;
  const biggest = Math.max(1, ...shown.map((f) => Math.abs(f.balanceCents)));
  const nodes = shown.map((f, i): StarNode => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / shown.length;
    const x = cx + ring * Math.cos(angle);
    const y = cy + ring * Math.sin(angle);
    const length = Math.max(0, ring - CENTRE_RADIUS - NODE_RADIUS);
    // Line runs from the centre disc's edge to the node's edge.
    const startR = CENTRE_RADIUS + length / 2;
    return {
      id: f.personId,
      name: f.name,
      balanceCents: f.balanceCents,
      x,
      y,
      flow: f.balanceCents < 0 ? 'toThem' : f.balanceCents > 0 ? 'toYou' : 'even',
      edge: {
        mx: cx + startR * Math.cos(angle),
        my: cy + startR * Math.sin(angle),
        length,
        thickness: f.balanceCents === 0 ? 0 : MIN_LINE + ((MAX_LINE - MIN_LINE) * Math.abs(f.balanceCents)) / biggest,
        angleDeg: (angle * 180) / Math.PI,
      },
    };
  });
  return { nodes, hidden: Math.max(0, ranked.length - shown.length), centre: { x: cx, y: cy } };
}
