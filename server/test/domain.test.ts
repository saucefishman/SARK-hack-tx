import { describe, expect, it } from "vitest";
import { dollarsToCents, formatCents } from "../src/domain/money";
import { splitEvent } from "../src/domain/split";
import { isRelevant, needsAttendeeReview } from "../src/domain/relevance";
import { estimateBaseCost, medianCents } from "../src/domain/estimateBaseCost";
import { eventId, stableId } from "../src/domain/ids";

describe("money", () => {
  it("dollarsToCents", () => {
    expect(dollarsToCents(12.5)).toBe(1250);
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents(0.29)).toBe(29);
    expect(dollarsToCents(-3)).toBe(-300);
    expect(() => dollarsToCents(NaN)).toThrow();
  });
  it("formatCents", () => {
    expect(formatCents(1250)).toBe("$12.50");
    expect(formatCents(-300)).toBe("-$3.00");
    expect(formatCents(5)).toBe("$0.05");
  });
});

describe("splitEvent", () => {
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  it("$120 / 4, user paid", () => {
    const r = splitEvent({ attendeeIds: ["p_me", "a", "b", "c"], payers: [{ personId: "p_me", amountCents: 12000 }] });
    expect(r.shareCents).toEqual({ a: 3000, b: 3000, c: 3000, p_me: 3000 });
    expect(r.pairs).toEqual([
      { creditorId: "p_me", debtorId: "a", amountCents: 3000 },
      { creditorId: "p_me", debtorId: "b", amountCents: 3000 },
      { creditorId: "p_me", debtorId: "c", amountCents: 3000 },
    ]);
  });
  it("$100 / 3 rounds exactly, tie by id", () => {
    const r = splitEvent({ attendeeIds: ["p_me", "a", "b"], payers: [{ personId: "p_me", amountCents: 10000 }] });
    expect(sum(r.shareCents)).toBe(10000);
    expect(r.shareCents).toEqual({ a: 3334, b: 3333, p_me: 3333 });
    expect(r.pairs.reduce((s, p) => s + p.amountCents, 0)).toBe(3334 + 3333);
  });
  it("multi-payer $60+$40 among 4; user owes A 1750, B 750", () => {
    const r = splitEvent({
      attendeeIds: ["p_me", "A", "B", "C"],
      payers: [{ personId: "A", amountCents: 6000 }, { personId: "B", amountCents: 4000 }],
    });
    expect(r.shareCents).toEqual({ A: 2500, B: 2500, C: 2500, p_me: 2500 });
    expect(r.pairs).toEqual([
      { creditorId: "A", debtorId: "p_me", amountCents: 1750 },
      { creditorId: "B", debtorId: "p_me", amountCents: 750 },
    ]);
    const all = splitEvent({ ...{ attendeeIds: ["p_me", "A", "B", "C"], payers: [{ personId: "A", amountCents: 6000 }, { personId: "B", amountCents: 4000 }] }, onlyTouching: null });
    expect(all.pairs).toHaveLength(4); // C owes A,B too
    expect(all.pairs.filter((p) => p.debtorId === "C").reduce((s, p) => s + p.amountCents, 0)).toBe(2500);
  });
  it("payer not in attendees still counts in headcount", () => {
    const r = splitEvent({ attendeeIds: ["p_me", "a"], payers: [{ personId: "z", amountCents: 9000 }] });
    expect(r.shareCents).toEqual({ a: 3000, p_me: 3000, z: 3000 });
    expect(r.pairs).toEqual([{ creditorId: "z", debtorId: "p_me", amountCents: 3000 }]);
  });
  it("user sole payer; non-user pairs filtered by default", () => {
    const r = splitEvent({ attendeeIds: ["a", "b"], payers: [{ personId: "p_me", amountCents: 9000 }] });
    expect(r.pairs.map((p) => p.debtorId)).toEqual(["a", "b"]);
  });
  it("zero total", () => {
    const r = splitEvent({ attendeeIds: ["p_me", "a"], payers: [{ personId: "p_me", amountCents: 0 }] });
    expect(r.shareCents).toEqual({ a: 0, p_me: 0 });
    expect(r.pairs).toEqual([]);
  });
  it("deterministic regardless of input order; pairs sum to deficit", () => {
    const a = splitEvent({ attendeeIds: ["p_me", "a", "b", "c", "d"], payers: [{ personId: "a", amountCents: 3333 }, { personId: "b", amountCents: 1001 }], onlyTouching: null });
    const b = splitEvent({ attendeeIds: ["d", "c", "b", "a", "p_me"], payers: [{ personId: "b", amountCents: 1001 }, { personId: "a", amountCents: 3333 }], onlyTouching: null });
    expect(a).toEqual(b);
    expect(sum(a.shareCents)).toBe(4334);
    for (const id of ["p_me", "c", "d"]) {
      const owed = a.pairs.filter((p) => p.debtorId === id).reduce((s, p) => s + p.amountCents, 0);
      expect(owed).toBe(a.shareCents[id]);
    }
  });
});

describe("relevance", () => {
  it.each([
    [["a", "b"], true, 2, true],
    [["a"], true, 2, false],
    [["a", "b"], false, 2, false],
    [["a", "b"], true, 1, false],
    [[], false, 0, false],
  ])("isRelevant(%j, paid=%s, sources=%s) = %s", (attendeeIds, paid, sourceCount, want) => {
    expect(isRelevant({ attendeeIds: attendeeIds as string[], paid, sourceCount })).toBe(want);
  });
  it("needsAttendeeReview", () => {
    expect(needsAttendeeReview({ sources: ["txn"], hasSimilarPastTxn: false })).toBe(true);
    expect(needsAttendeeReview({ sources: ["txn"], hasSimilarPastTxn: true })).toBe(false);
    expect(needsAttendeeReview({ sources: ["txn", "message"], hasSimilarPastTxn: false })).toBe(false);
    expect(needsAttendeeReview({ sources: [], hasSimilarPastTxn: false })).toBe(false);
  });
});

describe("estimateBaseCost", () => {
  const ev = { merchant: "Uchi", eventType: "dinner", date: "2026-03-12" };
  const noHist = async () => [];
  it("message-stated wins", async () => {
    const r = await estimateBaseCost({ ...ev, statedAmountCents: 12000 }, { history: async () => { throw new Error("no"); } });
    expect(r).toEqual({ amountCents: 12000, basis: "confirmed", source: "message" });
  });
  it("history median (odd, even floor), passes before date", async () => {
    let seen: unknown;
    const r = await estimateBaseCost(ev, { history: async (q) => ((seen = q), [9000, 1000, 5000]) });
    expect(r).toEqual({ amountCents: 5000, basis: "estimated", source: "history" });
    expect(seen).toEqual({ merchant: "Uchi", eventType: "dinner", before: "2026-03-12" });
    expect(medianCents([1001, 1002])).toBe(1001);
    expect(medianCents([100, 200, 300, 500])).toBe(250);
  });
  it("cold start scales by headcount", async () => {
    const r = await estimateBaseCost({ ...ev, headcount: 4 }, { history: noHist, coldStart: async () => ({ perPersonCents: 3000, sourceUrl: "u", confidence: 0.3 }) });
    expect(r).toEqual({ amountCents: 12000, basis: "estimated", source: "cold_start" });
  });
  it("null when nothing (default stub)", async () => {
    expect(await estimateBaseCost(ev, { history: noHist })).toBeNull();
  });
});

describe("ids", () => {
  it("stableId deterministic, prefixed, 16 hex", () => {
    expect(stableId("ev", "a", "b")).toBe(stableId("ev", "a", "b"));
    expect(stableId("ev", "a", "b")).toMatch(/^ev_[0-9a-f]{16}$/);
    expect(stableId("ev", "ab")).not.toBe(stableId("ev", "a", "b"));
  });
  it("eventId order-independent", () => {
    const a = eventId({ date: "2026-03-12", attendeeIds: ["x", "y", "z"], anchor: "t1" });
    expect(eventId({ date: "2026-03-12", attendeeIds: ["z", "x", "y"], anchor: "t1" })).toBe(a);
    expect(eventId({ date: "2026-03-12", attendeeIds: ["x", "y", "z"], anchor: "t2" })).not.toBe(a);
  });
});
