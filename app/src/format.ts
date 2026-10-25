/** The one money formatter. Cents (integer) -> "$1,234.50". */
export function formatCents(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rem = (abs % 100).toString().padStart(2, "0");
  return `${cents < 0 ? "-" : ""}$${dollars}.${rem}`;
}

/** balanceCents: positive = friend owes user, negative = user owes friend. */
export function balanceLabel(balanceCents: number, name: string): string {
  if (balanceCents === 0) return "even";
  if (balanceCents > 0) return `${name} owes you ${formatCents(balanceCents)}`;
  return `you owe ${name} ${formatCents(-balanceCents)}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso;
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
