// Money helpers. Cents are integers everywhere; dollars only at the edges.

/** Dollars (number) to integer cents, rounded to nearest. Throws on NaN/Infinity. */
export function dollarsToCents(n: number): number {
  if (!Number.isFinite(n)) throw new Error(`dollarsToCents: invalid amount ${n}`);
  return Math.round(n * 100 + Math.sign(n) * 1e-9);
}

/** Cents to display string for logs: 1250 -> "$12.50", -300 -> "-$3.00". */
export function formatCents(c: number): string {
  const abs = Math.abs(Math.round(c));
  const s = `$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return c < 0 ? `-${s}` : s;
}
