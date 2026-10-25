import { describe, expect, it } from "vitest";
import { solvePayback, toleranceCents, type PaybackOption } from "../src/domain/payback";
import { addDays, daysBetween, detectPatterns, type Occurrence } from "../src/domain/recurrence";

const cfg = { asOf: "2026-10-25", tolerancePct: 10, toleranceMinCents: 1000, maxBundle: 3 };
const opt = (id: string, cents: number, extra: Partial<PaybackOption> = {}): PaybackOption => ({
  id, kind: "planned", title: id, date: null, lowCents: cents, highCents: cents, confidence: 1, trust: 1, ...extra,
});

describe("toleranceCents", () => {
  it("is the larger of the minimum and the percentage", () => {
    expect(toleranceCents(11600, cfg)).toBe(1160);
    expect(toleranceCents(3000, cfg)).toBe(1000);
  });
});

describe("solvePayback", () => {
  it("finds the exact bundle first, then near ones", () => {
    const r = solvePayback(11600, [opt("concert", 5900), opt("dinner", 5700), opt("thai", 1700), opt("climb", 3000)], cfg);
    expect(r.needsTransfer).toBe(false);
    expect(r.bundles[0]).toMatchObject({ optionIds: ["concert", "dinner"], kind: "exact", lowCents: 11600, highCents: 11600 });
    expect(r.bundles.map((b) => b.optionIds.join("+"))).toContain("climb+concert+thai"); // 106 is inside 116 +- 11.60
  });

  it("a range option settles the debt when the debt falls inside it", () => {
    const r = solvePayback(5000, [opt("show", 0 + 4000, { highCents: 6000 })], cfg);
    expect(r.bundles).toEqual([expect.objectContaining({ optionIds: ["show"], kind: "exact" })]);
  });

  it("prefers landing under the debt to overshooting it", () => {
    const r = solvePayback(10000, [opt("under", 9500), opt("over", 10500)], { ...cfg, maxBundle: 1 });
    expect(r.bundles[0]!.optionIds).toEqual(["under"]);
  });

  it("falls back to a partial bundle and asks for a transfer when nothing fits", () => {
    const r = solvePayback(50000, [opt("a", 6000), opt("b", 3000)], cfg);
    expect(r.needsTransfer).toBe(true);
    expect(r.bundles).toEqual([expect.objectContaining({ optionIds: ["a", "b"], kind: "partial", highCents: 9000 })]);
  });

  it("never offers a bundle that overshoots beyond the tolerance as partial", () => {
    const r = solvePayback(2000, [opt("big", 9000)], cfg);
    expect(r.bundles).toEqual([]);
    expect(r.needsTransfer).toBe(true);
  });

  it("returns nothing for a debt of zero", () => {
    expect(solvePayback(0, [opt("a", 100)], cfg)).toEqual({ toleranceCents: 1000, bundles: [], needsTransfer: false });
  });

  it("never combines two options on one date or with one activity key", () => {
    const r = solvePayback(6000, [
      opt("a", 3000, { date: "2026-11-01" }), opt("b", 3000, { date: "2026-11-01" }),
      opt("c", 3000, { activityKey: "ramen" }), opt("d", 3000, { activityKey: "ramen" }),
    ], { ...cfg, maxBundle: 2, tolerancePct: 0, toleranceMinCents: 0 });
    for (const b of r.bundles) {
      expect(b.optionIds).not.toEqual(["a", "b"]);
      expect(b.optionIds).not.toEqual(["c", "d"]);
    }
    expect(r.bundles[0]!.kind).toBe("exact");
  });

  it("ranks a planned bundle above a discovered one with the same total", () => {
    const r = solvePayback(5000, [opt("plan", 5000, { trust: 1 }), opt("idea", 5000, { kind: "discovered", trust: 0.4 })], { ...cfg, maxBundle: 1 });
    expect(r.bundles.map((b) => b.optionIds[0])).toEqual(["plan", "idea"]);
  });

  it("is deterministic: ties break by option id", () => {
    const opts = [opt("b", 5000), opt("a", 5000)];
    const r1 = solvePayback(5000, opts, { ...cfg, maxBundle: 1 });
    const r2 = solvePayback(5000, [...opts].reverse(), { ...cfg, maxBundle: 1 });
    expect(r1).toEqual(r2);
    expect(r1.bundles[0]!.optionIds).toEqual(["a"]);
  });
});

describe("detectPatterns", () => {
  const occ = (key: string, date: string, pp: number | null = 2000, id = `${key}@${date}`): Occurrence => ({ key, date, perPersonCents: pp, eventId: id });

  it("needs at least three occurrences", () => {
    expect(detectPatterns([occ("ember", "2026-07-02"), occ("ember", "2026-07-23")], "2026-10-25")).toEqual([]);
  });

  it("predicts the next date, rolling forward in whole gaps past asOf", () => {
    const [p] = detectPatterns([occ("ember", "2026-07-02", 2000), occ("ember", "2026-07-23", 3000), occ("ember", "2026-08-20", 2400)], "2026-10-25");
    expect(p).toMatchObject({ key: "ember", occurrences: 3, lastDate: "2026-08-20", medianGapDays: 24.5, perPersonLowCents: 2000, perPersonMedianCents: 2400, perPersonHighCents: 3000 });
    expect(p!.regularity).toBeCloseTo(1 - 3.5 / 24.5, 5);
    expect(p!.nextDate > "2026-10-25").toBe(true);
    expect(daysBetween("2026-08-20", p!.nextDate) % 25).toBeLessThan(3); // a whole number of ~25-day gaps from the last one
  });

  it("snaps to the habitual weekday", () => {
    // 2026-07-06, 07-20, 08-03 are Mondays, 14 days apart
    const [p] = detectPatterns([occ("run", "2026-07-06"), occ("run", "2026-07-20"), occ("run", "2026-08-03")], "2026-08-10");
    expect(p).toMatchObject({ weekday: 1, nextDate: "2026-08-17" });
  });

  it("drops irregular and lapsed patterns", () => {
    expect(detectPatterns([occ("x", "2026-01-01"), occ("x", "2026-01-03"), occ("x", "2026-04-20")], "2026-05-01")).toEqual([]); // gaps 2 and 107
    expect(detectPatterns([occ("y", "2026-01-01"), occ("y", "2026-01-08"), occ("y", "2026-01-15")], "2026-10-25")).toEqual([]); // idle for ~40 gaps
  });

  it("counts two events on one day once, and tolerates unpriced occurrences", () => {
    const ps = detectPatterns([occ("z", "2026-09-01", null), occ("z", "2026-09-01", 5000, "zzz-later-id"), occ("z", "2026-09-15", null), occ("z", "2026-09-29", null)], "2026-10-05");
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ occurrences: 3, perPersonLowCents: null, perPersonMedianCents: null });
  });

  it("addDays/daysBetween round trip", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });
});
