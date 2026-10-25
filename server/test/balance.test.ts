import type { LedgerEntry } from "@sark/shared";
import { describe, expect, it } from "vitest";
import { friendTotals } from "../src/domain/balance";

const row = (p: Partial<LedgerEntry>): LedgerEntry => ({
  id: Math.random().toString(36),
  eventId: "e1",
  payerId: "p_me",
  beneficiaryId: "p_alex",
  amountCents: 0,
  kind: "covered",
  basis: "confirmed",
  confidence: 1,
  evidenceMessageId: null,
  txnId: null,
  ...p,
});

describe("friendTotals", () => {
  it("user covered then friend repaid → even", () => {
    const t = friendTotals("p_alex", [
      row({ amountCents: 3000 }),
      row({ kind: "repayment", payerId: "p_alex", beneficiaryId: "p_me", amountCents: 3000, eventId: null }),
    ]);
    expect(t).toEqual({ spentOnYouCents: 0, youSpentOnThemCents: 3000, balanceCents: 0, possibleCents: 0, eventCount: 1 });
  });
  it("friend covered user; assumed rows only in possible", () => {
    const t = friendTotals("p_sam", [
      row({ payerId: "p_sam", beneficiaryId: "p_me", amountCents: 2800 }),
      row({ eventId: "e2", payerId: "p_sam", beneficiaryId: "p_me", amountCents: 5000, basis: "assumed" }),
      row({ eventId: "e3", payerId: "p_sam", beneficiaryId: "p_me", amountCents: 1000, basis: "estimated" }),
      row({ payerId: "p_alex", beneficiaryId: "p_me", amountCents: 999 }),
    ]);
    expect(t).toEqual({ spentOnYouCents: 3800, youSpentOnThemCents: 0, balanceCents: -3800, possibleCents: 5000, eventCount: 3 });
  });
});
