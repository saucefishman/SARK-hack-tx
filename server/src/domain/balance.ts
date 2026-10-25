// Per-friend ledger totals (DESIGN.md section 5, ledger_entry notes). Pure.
import { USER_ID, type LedgerEntry } from "@sark/shared";

export interface FriendTotals {
  spentOnYouCents: number;
  youSpentOnThemCents: number;
  /** Positive = friend owes user. */
  balanceCents: number;
  /** Assumed rows; excluded from balance. */
  possibleCents: number;
  eventCount: number;
}

const COUNTS = new Set(["confirmed", "estimated", "crowd"]);

/** Totals for one friend from ledger entries (entries not touching this friend + user are ignored). */
export function friendTotals(friendId: string, entries: LedgerEntry[], userId = USER_ID): FriendTotals {
  const t: FriendTotals = { spentOnYouCents: 0, youSpentOnThemCents: 0, balanceCents: 0, possibleCents: 0, eventCount: 0 };
  const events = new Set<string>();
  for (const e of entries) {
    const fromFriend = e.payerId === friendId && e.beneficiaryId === userId;
    const fromUser = e.payerId === userId && e.beneficiaryId === friendId;
    if (!fromFriend && !fromUser) continue;
    if (e.eventId) events.add(e.eventId);
    if (e.basis === "assumed") {
      if (e.kind === "covered") t.possibleCents += e.amountCents;
      continue;
    }
    if (!COUNTS.has(e.basis)) continue;
    if (e.kind === "covered") {
      if (fromFriend) t.spentOnYouCents += e.amountCents;
      else t.youSpentOnThemCents += e.amountCents;
    }
    if (e.kind === "covered" || e.kind === "repayment") {
      t.balanceCents += fromUser ? e.amountCents : -e.amountCents;
    }
  }
  t.eventCount = events.size;
  return t;
}
