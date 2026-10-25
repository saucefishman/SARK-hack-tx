// Equal split with multiple payers (DESIGN section 6d). Pure, integer cents, deterministic.
import { USER_ID } from "@sark/shared";

export interface SplitInput {
  attendeeIds: string[];
  payers: { personId: string; amountCents: number }[];
  /** Keep only pairs touching this person (default USER_ID); null keeps all pairs. */
  onlyTouching?: string | null;
}

export interface SplitPair {
  creditorId: string;
  debtorId: string;
  amountCents: number;
}

export interface SplitResult {
  shareCents: Record<string, number>;
  pairs: SplitPair[];
}

/**
 * Split `total` cents proportionally to integer `weights` (keyed by id) using largest remainder.
 * Ties broken by id ascending. Result sums exactly to `total` (if weights sum > 0).
 */
export function allocate(total: number, weights: Record<string, number>): Record<string, number> {
  const ids = Object.keys(weights).sort();
  const W = ids.reduce((s, id) => s + weights[id], 0);
  const out: Record<string, number> = {};
  if (W <= 0) {
    for (const id of ids) out[id] = 0;
    return out;
  }
  const rems: { id: string; rem: number }[] = [];
  let given = 0;
  for (const id of ids) {
    const num = total * weights[id];
    out[id] = Math.floor(num / W);
    given += out[id];
    rems.push({ id, rem: num % W });
  }
  rems.sort((a, b) => b.rem - a.rem || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < total - given; i++) out[rems[i].id] += 1;
  return out;
}

export function splitEvent(input: SplitInput): SplitResult {
  const userId = input.onlyTouching === undefined ? USER_ID : input.onlyTouching;
  const paid: Record<string, number> = {};
  for (const p of input.payers) paid[p.personId] = (paid[p.personId] ?? 0) + p.amountCents;
  const total = Object.values(paid).reduce((s, v) => s + v, 0);
  const headcount = [...new Set([...input.attendeeIds, ...Object.keys(paid)])].sort();

  const shareCents = headcount.length
    ? allocate(total, Object.fromEntries(headcount.map((id) => [id, 1])))
    : {};

  const surplus: Record<string, number> = {};
  for (const id of headcount) surplus[id] = (paid[id] ?? 0) - shareCents[id];
  const creditors = Object.fromEntries(headcount.filter((id) => surplus[id] > 0).map((id) => [id, surplus[id]]));

  const pairs: SplitPair[] = [];
  for (const debtorId of headcount) {
    if (surplus[debtorId] >= 0) continue;
    const split = allocate(-surplus[debtorId], creditors);
    for (const creditorId of Object.keys(split).sort()) {
      if (split[creditorId] <= 0) continue;
      if (userId != null && creditorId !== userId && debtorId !== userId) continue;
      pairs.push({ creditorId, debtorId, amountCents: split[creditorId] });
    }
  }
  return { shareCents, pairs };
}
