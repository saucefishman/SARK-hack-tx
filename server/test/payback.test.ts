import { describe, expect, it } from "vitest";
import { acceptMessagePlan, mergePlans, type PlanSource, type RawPlan } from "../src/domain/plans";
import { isNovel, solvePayback, toleranceCents, TRUST, type PaybackOption } from "../src/domain/payback";
import { planFinder } from "../src/llm";
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

describe("TRUST tiers", () => {
  it("planned and discovered share the top tier; recurring tops out below both", () => {
    expect(TRUST.planned).toBe(1);
    expect(TRUST.discovered).toBeGreaterThanOrEqual(0.9);
    expect(TRUST.recurringMax).toBeLessThan(TRUST.discovered);
  });
  it("a discovered idea outranks a recurring outing of the same price, and is close to a planned one", () => {
    const base = { lowCents: 5000, highCents: 5000, confidence: 0.6, date: null } as const;
    const r = solvePayback(5000, [
      { ...base, id: "rec", kind: "recurring", title: "rec", trust: TRUST.recurringMax * 0.9 },
      { ...base, id: "new", kind: "discovered", title: "new", trust: TRUST.discovered },
      { ...base, id: "plan", kind: "planned", title: "plan", trust: TRUST.planned },
    ], { ...cfg, maxBundle: 1 });
    expect(r.bundles.map((b) => b.optionIds[0])).toEqual(["plan", "new", "rec"]);
  });
});

describe("isNovel", () => {
  it("rejects anything the pair already does or has planned, in either direction", () => {
    expect(isNovel("Ember Bar Happy Hour", ["ember bar"])).toBe(false);
    expect(isNovel("Uchi", ["Dinner at Uchi"])).toBe(false);
    expect(isNovel("Odd Duck", ["ember bar", "uchi"])).toBe(true);
  });
  it("ignores punctuation and case, and never matches on tiny keys", () => {
    expect(isNovel("The Ember-Bar!", ["EMBER BAR"])).toBe(false);
    expect(isNovel("Taco Place", ["ta"])).toBe(true);
    expect(isNovel("Taco Place", [""])).toBe(true);
  });
});

describe("acceptMessagePlan", () => {
  const ctx = { asOf: "2026-10-25", knownIds: new Set(["p_me", "p_alex", "p_sam"]), messageIds: new Set(["m1", "m2"]) };
  const plan = (o: Partial<RawPlan> = {}): RawPlan => ({
    date: "2026-11-20", description: " Trivia ", peopleIds: ["p_me", "p_alex"], sourceMessageIds: ["m1"], ...o,
  });

  it("accepts a concrete future plan and cleans it up (dollars to cents in code)", () => {
    expect(acceptMessagePlan(plan({ perPersonAmountDollars: 12.5, time: "19:30", venue: " Hole in the Wall " }), ctx)).toEqual({
      ok: true,
      plan: { date: "2026-11-20", time: "19:30", description: "Trivia", venue: "Hole in the Wall", peopleIds: ["p_me", "p_alex"], perPersonCents: 1250, sourceMessageIds: ["m1"] },
    });
  });
  it("rejects bad, past, today and far-future dates", () => {
    expect(acceptMessagePlan(plan({ date: "next friday" }), ctx)).toEqual({ ok: false, reason: "bad_date" });
    expect(acceptMessagePlan(plan({ date: "2026-02-30" }), ctx)).toEqual({ ok: false, reason: "bad_date" });
    expect(acceptMessagePlan(plan({ date: "2026-10-24" }), ctx)).toEqual({ ok: false, reason: "not_future" });
    expect(acceptMessagePlan(plan({ date: "2026-10-25" }), ctx)).toEqual({ ok: false, reason: "not_future" });
    expect(acceptMessagePlan(plan({ date: "2027-06-01" }), ctx)).toEqual({ ok: false, reason: "too_far" });
  });
  it("rejects plans a friend is paying for, but not ones the user pays for", () => {
    expect(acceptMessagePlan(plan({ payerId: "p_alex" }), ctx)).toEqual({ ok: false, reason: "friend_paying" });
    expect(acceptMessagePlan(plan({ payerId: "p_me" }), ctx).ok).toBe(true);
  });
  it("rejects hallucinated sources and plans with no known friend; drops unknown people", () => {
    expect(acceptMessagePlan(plan({ sourceMessageIds: ["nope"] }), ctx)).toEqual({ ok: false, reason: "no_source" });
    expect(acceptMessagePlan(plan({ peopleIds: ["p_me"] }), ctx)).toEqual({ ok: false, reason: "no_friend" });
    expect(acceptMessagePlan(plan({ peopleIds: ["p_me", "p_ghost"] }), ctx)).toEqual({ ok: false, reason: "no_friend" });
    const ok = acceptMessagePlan(plan({ peopleIds: ["p_me", "p_alex", "p_ghost"], sourceMessageIds: ["m1", "nope", "m2"] }), ctx);
    expect(ok.ok && ok.plan).toMatchObject({ peopleIds: ["p_me", "p_alex"], sourceMessageIds: ["m1", "m2"] });
  });
  it("ignores a malformed time and a non-positive price", () => {
    const r = acceptMessagePlan(plan({ time: "7pm", perPersonAmountDollars: 0 }), ctx);
    expect(r.ok && r.plan).toMatchObject({ time: null, perPersonCents: null });
  });
});

describe("mergePlans", () => {
  const src = (o: Partial<PlanSource> & Pick<PlanSource, "ref" | "source">): PlanSource => ({
    title: "x", date: "2026-11-07", time: null, peopleIds: ["p_me", "p_alex"], statedPerPersonCents: null, evidence: `from ${o.source}`, ...o,
  });
  it("same day with a friend in common is one plan; the calendar entry wins and the chat's price is kept", () => {
    const out = mergePlans([
      src({ ref: "chat1", source: "message", title: "concert", statedPerPersonCents: 5900, evidence: "chat says $59" }),
      src({ ref: "cal1", source: "calendar", title: "Khruangbin", evidence: "calendar entry" }),
    ]);
    expect(out).toEqual([expect.objectContaining({ ref: "cal1", title: "Khruangbin", source: "calendar", statedPerPersonCents: 5900, evidence: "calendar entry chat says $59" })]);
  });
  it("keeps the calendar's own price when both have one", () => {
    const out = mergePlans([src({ ref: "c", source: "calendar", statedPerPersonCents: 4000 }), src({ ref: "m", source: "message", statedPerPersonCents: 5000 })]);
    expect(out[0]!.statedPerPersonCents).toBe(4000);
  });
  it("different days, or no friend in common, stay separate; output is ordered by date", () => {
    const out = mergePlans([
      src({ ref: "b", source: "message", date: "2026-11-20" }),
      src({ ref: "a", source: "calendar", date: "2026-11-07" }),
      src({ ref: "c", source: "message", date: "2026-11-07", peopleIds: ["p_me", "p_sam"] }),
    ]);
    expect(out.map((p) => p.ref)).toEqual(["a", "c", "b"]);
  });
  it("two chat mentions of one plan collapse too", () => {
    expect(mergePlans([src({ ref: "m1", source: "message" }), src({ ref: "m2", source: "message" })])).toHaveLength(1);
  });
});

describe("planFinder prompt", () => {
  const input = { asOf: "2026-10-25", threadId: "weekendplans_plans1", threadTitle: "Chat with Alex", people: [{ id: "p_me", name: "Me" }], messages: [] };
  it("has a stable fixture key and states today, the output shape and the exclusions", () => {
    expect(planFinder.fixtureKey(input)).toBe("2026-10-25__weekendplans-plans1");
    const text = planFinder.render(input);
    expect(text).toContain("Today is 2026-10-25");
    expect(text).toContain("hypotheticals");
    expect(text).toContain("payerId");
    expect(text).toContain("Never do arithmetic");
  });
  it("its schema accepts a minimal plan and rejects a plan with no date", () => {
    expect(planFinder.schema.safeParse({ plans: [{ date: "2026-11-20", description: "x", peopleIds: ["p_me"], sourceMessageIds: ["m"] }] }).success).toBe(true);
    expect(planFinder.schema.safeParse({ plans: [{ description: "x", peopleIds: [], sourceMessageIds: [] }] }).success).toBe(false);
  });
});
