// Independent equal-split oracle for seed truth (DESIGN.md 6d). Deliberately NOT shared with
// pipeline domain/split.ts: truth must be computable without the code under test.
// All amounts are integer cents.

export interface OraclePayer { personId: string; amountCents: number }
export interface OracleEdge { payerId: string; beneficiaryId: string; amountCents: number }

/** Equal shares of total over attendees; remainder cents go to the lowest person ids first (largest-remainder, equal fractions tie by id). */
export function equalShares(totalCents: number, attendeeIds: string[]): Record<string, number> {
  const ids = [...attendeeIds].sort();
  const base = Math.floor(totalCents / ids.length);
  const rem = totalCents - base * ids.length;
  return Object.fromEntries(ids.map((id, i) => [id, base + (i < rem ? 1 : 0)]));
}

/** Distribute `amount` over weights, floor + largest remainder, ties by key asc. */
function prorate(amount: number, weights: [string, number][]): Record<string, number> {
  const sum = weights.reduce((s, [, w]) => s + w, 0);
  const rows = weights.map(([k, w]) => ({ k, floor: Math.floor((amount * w) / sum), frac: (amount * w) % sum }));
  let left = amount - rows.reduce((s, r) => s + r.floor, 0);
  const order = [...rows].sort((a, b) => b.frac - a.frac || a.k.localeCompare(b.k));
  const out: Record<string, number> = Object.fromEntries(rows.map((r) => [r.k, r.floor]));
  for (const r of order) {
    if (left <= 0) break;
    out[r.k] += 1;
    left -= 1;
  }
  return out;
}

/**
 * Directional edges (creditor -> debtor) for one event. surplus = paid - share;
 * each debtor repays creditors pro rata to creditor surplus. Only edges touching `userId` are kept.
 */
export function splitEdges(attendeeIds: string[], payers: OraclePayer[], userId: string): OracleEdge[] {
  const total = payers.reduce((s, p) => s + p.amountCents, 0);
  const shares = equalShares(total, attendeeIds);
  const paid: Record<string, number> = {};
  for (const p of payers) paid[p.personId] = (paid[p.personId] ?? 0) + p.amountCents;
  const surplus = Object.keys(shares).sort().map((id) => [id, (paid[id] ?? 0) - shares[id]] as [string, number]);
  const creditors = surplus.filter(([, s]) => s > 0);
  const edges: OracleEdge[] = [];
  for (const [debtor, s] of surplus.filter(([, s]) => s < 0)) {
    const split = prorate(-s, creditors);
    for (const [creditor] of creditors) {
      const amountCents = split[creditor];
      if (amountCents > 0 && (creditor === userId || debtor === userId)) {
        edges.push({ payerId: creditor, beneficiaryId: debtor, amountCents });
      }
    }
  }
  return edges;
}

/** Median of cents; even counts take the floor of the mean of the middle two. */
export function medianCents(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.floor((v[mid - 1] + v[mid]) / 2);
}
