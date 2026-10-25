// Payback stage end to end on the seed (replay): debts -> plans / patterns / SerpAPI fixtures -> bundles -> API.
import { PaybackResponse } from "@sark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app";
import { generateSeed } from "../src/seed/generate";
import { loadScenario } from "../src/seed/write";
import { eventsFromSerp, parseDollarRange, placesFromSerp, PRICE_LEVEL_BANDS, resolveMonthDay } from "../src/domain/serpPrice";
import type { Db } from "../src/db/pool";
import { friendShareCents, runPayback, solveFriend } from "../src/pipeline/payback";
import { runPipeline } from "../src/pipeline/run";
import { sourcesFromDir } from "../src/sources";
import { cachedSerp, fixtureName, replayClient, SerpBudgetExceeded, SerpReplayMiss, type SerpApiClient } from "../src/sources/serpapi";
import { testDb } from "./helpers";
import { writeTempSeed } from "./tempSeed";

const truth = generateSeed(loadScenario()).truth;
const dir = writeTempSeed();
const owed = -truth.friends.p_alex.balanceCents; // 9466: Alex covered Hamilton

describe("payback stage on the seed", () => {
  let db: Db;
  let counts: Record<string, number>;
  beforeAll(async () => {
    db = await testDb();
    counts = await runPipeline(db, { llmMode: "replay", sources: sourcesFromDir(dir) });
  });

  it("only the friend the user owes is a debtor, and the debt equals truth", async () => {
    expect(owed).toBeGreaterThan(0);
    expect(Object.entries(truth.friends).filter(([, f]) => f.balanceCents < 0).map(([id]) => id)).toEqual(["p_alex"]);
    expect(counts["payback.debtors"]).toBe(1);
    const alex = await solveFriend(db, "p_alex");
    expect(alex.debtCents).toBe(owed);
    for (const id of ["p_sam", "p_jordan", "p_riley"]) {
      expect(await solveFriend(db, id)).toMatchObject({ debtCents: 0, suggestions: [], needsTransfer: false });
    }
  });

  it("future calendar entries are plans, not events: they never reach the event table or the ledger", async () => {
    const { rows } = await db.query("SELECT 1 FROM event WHERE date > '2026-10-25'");
    expect(rows).toEqual([]);
    const fe = await db.query<{ description: string }>("SELECT description FROM future_event ORDER BY date");
    expect(fe.rows.map((r) => r.description)).toEqual(["Khruangbin at Moody Center", "Dinner at Uchi"]);
  });

  it("every suggestion settles the debt within tolerance, with receipts", async () => {
    const r = await solveFriend(db, "p_alex");
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.needsTransfer).toBe(false);
    for (const s of r.suggestions) {
      expect(s.kind).toBe("exact");
      expect(owed).toBeGreaterThanOrEqual(s.totalLowCents - r.toleranceCents);
      expect(owed).toBeLessThanOrEqual(s.totalHighCents + r.toleranceCents);
      expect(s.items.length).toBeLessThanOrEqual(3);
      for (const it of s.items) expect(it.evidence.length).toBeGreaterThan(10);
    }
    expect(PaybackResponse.safeParse(r).success).toBe(true);
  });

  it("the best bundle is the two planned events: $59 tickets (stated on the calendar) + Uchi at the user's historical $30 a head", async () => {
    const best = (await solveFriend(db, "p_alex")).suggestions[0]!;
    expect(best.items.map((i) => [i.title, i.kind, i.friendShareLowCents, i.friendShareHighCents, i.basis])).toEqual([
      ["Khruangbin at Moody Center", "planned", 5900, 5900, "confirmed"],
      ["Dinner at Uchi", "planned", 3000, 3000, "estimated"],
    ]);
    expect([best.totalLowCents, best.totalHighCents]).toEqual([8900, 8900]);
  });

  it("finds the recurring Ember Bar outings with Alex (3 times) and predicts a future date", async () => {
    const { rows } = await db.query<{ activity_key: string; occurrences: number; next: string; low: number; high: number }>(
      "SELECT activity_key, occurrences, next_date_pred::text AS next, per_person_low_cents AS low, per_person_high_cents AS high FROM recurring_pattern WHERE friend_id = 'p_alex'",
    );
    // Ember: 07-02 (60/3), 07-23 (90/3), 08-20 (72/3)
    expect(rows).toEqual([{ activity_key: "ember bar", occurrences: 3, next: expect.stringMatching(/^2026-1[12]-/), low: 2000, high: 3000 }]);
    expect(rows[0]!.next > "2026-10-25").toBe(true);
  });

  it("discovered options come from SerpAPI fixtures; priceless results are skipped; bands are flagged low confidence", async () => {
    const { rows } = await db.query<{ title: string; confidence: number; low: number; high: number; url: string | null }>(
      "SELECT title, confidence, friend_share_low_cents AS low, friend_share_high_cents AS high, url FROM payback_candidate WHERE kind = 'discovered' ORDER BY title",
    );
    const by = Object.fromEntries(rows.map((r) => [r.title, r]));
    expect(by["Austin FC vs. Sporting KC"]).toMatchObject({ low: 3800, high: 3800, confidence: 0.6 }); // "$38" in the description
    expect(by["Comedy at The Creek and The Cave"]).toMatchObject({ low: 2200, high: 2200 }); // ticket_info price
    expect(by["Whisler's"]).toMatchObject({ low: PRICE_LEVEL_BANDS.$$![0], high: PRICE_LEVEL_BANDS.$$![1], confidence: 0.3 });
    expect(by["Veracruz All Natural"]).toMatchObject({ low: 1000, high: 2000, confidence: 0.6 }); // stated "$10–20"
    expect(by["Free Week Open Mic"]).toBeUndefined(); // no price anywhere
    expect(counts["payback.serpCalls"]).toBe(3);
  });

  it("is idempotent, and a dismissal survives a rebuild", async () => {
    const snap = async () => JSON.stringify((await db.query("SELECT * FROM payback_suggestion ORDER BY id")).rows.map(({ computed_at, ...r }) => r));
    const before = await snap();
    await runPayback(db);
    expect(await snap()).toBe(before);

    const app = await buildApp({ db, llmMode: "replay" });
    const first = (await app.inject("/friends/p_alex/payback")).json();
    const gone = await app.inject({ method: "POST", url: `/payback/${first.suggestions[0].id}/dismiss` });
    expect(gone.statusCode).toBe(200);
    expect(gone.json().suggestions.map((s: { id: string }) => s.id)).not.toContain(first.suggestions[0].id);
    await runPayback(db);
    expect((await solveFriend(db, "p_alex")).suggestions.map((s) => s.id)).not.toContain(first.suggestions[0].id);
    await app.close();
  });
});

describe("payback API", () => {
  it("GET /friends/:id/payback, paybackCount on /friends, 404s", async () => {
    const db = await testDb();
    await runPipeline(db, { llmMode: "replay", sources: sourcesFromDir(dir) });
    const app = await buildApp({ db, llmMode: "replay" });
    const res = await app.inject("/friends/p_alex/payback");
    expect(res.statusCode).toBe(200);
    expect(PaybackResponse.parse(res.json())).toMatchObject({ friend: { personId: "p_alex" }, debtCents: owed });
    const friends = (await app.inject("/friends")).json() as { personId: string; paybackCount?: number }[];
    expect(friends.find((f) => f.personId === "p_alex")!.paybackCount).toBeGreaterThan(0);
    expect(friends.filter((f) => f.personId !== "p_alex").every((f) => f.paybackCount === undefined)).toBe(true);
    expect((await app.inject("/friends/p_sam/payback")).json()).toMatchObject({ debtCents: 0, suggestions: [] });
    expect((await app.inject("/friends/nobody/payback")).statusCode).toBe(404);
    expect((await app.inject("/friends/p_me/payback")).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/payback/ps_nope/dismiss" })).statusCode).toBe(404);
    await app.close();
  });

  it("a debt that disappears removes the suggestions on the next read (no repricing)", async () => {
    const db = await testDb();
    await runPipeline(db, { llmMode: "replay", sources: sourcesFromDir(dir) });
    await db.query(
      "INSERT INTO ledger_entry (id, payer_id, beneficiary_id, amount_cents, kind, basis) VALUES ('rp_test','p_me','p_alex',$1,'repayment','confirmed')",
      [owed],
    );
    expect(await solveFriend(db, "p_alex")).toMatchObject({ debtCents: 0, suggestions: [], needsTransfer: false });
    expect((await db.query("SELECT 1 FROM payback_suggestion WHERE friend_id = 'p_alex'")).rows).toEqual([]);
  });
});

describe("friendShareCents", () => {
  it("is the per-person price whatever the group size (user pays the whole bill)", () => {
    expect(friendShareCents(3000, 2, "p_alex")).toBe(3000);
    expect(friendShareCents(3000, 5, "p_alex")).toBe(3000);
    expect(friendShareCents(3333, 3, "p_alex")).toBe(3333);
  });
});

describe("SerpAPI adapter", () => {
  it("replay reads fixtures by engine + slugged query and throws SerpReplayMiss otherwise", async () => {
    expect(fixtureName("google_maps", "bar in Austin, Texas")).toBe("google_maps__bar-in-austin-texas.json");
    const c = replayClient();
    expect(((await c.search("google_maps", "bar in Austin, Texas", "x")) as { local_results: unknown[] }).local_results).toHaveLength(3);
    await expect(c.search("google_maps", "no such query", "x")).rejects.toBeInstanceOf(SerpReplayMiss);
  });

  it("caches per day and enforces the call budget", async () => {
    const db = await testDb();
    let calls = 0;
    const client: SerpApiClient = { search: async () => ({ n: ++calls }) };
    const s = cachedSerp(db, client, { day: "2026-10-25", location: "Austin", maxCalls: 2 });
    expect(await s.search("google_maps", "a")).toEqual({ n: 1 });
    expect(await s.search("google_maps", "a")).toEqual({ n: 1 }); // cache hit: free
    expect(await s.search("google_maps", "b")).toEqual({ n: 2 });
    await expect(s.search("google_maps", "c")).rejects.toBeInstanceOf(SerpBudgetExceeded);
    expect(s.state).toEqual({ calls: 2, hits: 1 });
    const next = cachedSerp(db, client, { day: "2026-10-26", location: "Austin", maxCalls: 2 });
    expect(await next.search("google_maps", "a")).toEqual({ n: 3 }); // a new day misses
  });

  it("a missing fixture is skipped, not fatal", async () => {
    const db = await testDb();
    await runPipeline(db, { llmMode: "replay", sources: sourcesFromDir(dir) });
    const miss: SerpApiClient = { search: async () => { throw new SerpReplayMiss("x.json"); } };
    await db.exec("DELETE FROM price_quote");
    const c = await runPayback(db, { serp: miss });
    expect(c.serpMisses).toBe(3);
    expect(c.discovered).toBe(0);
    expect(c.suggestions).toBeGreaterThan(0); // planned + recurring still settle the debt
  });
});

describe("serpPrice extraction", () => {
  it("parses dollar figures and ranges", () => {
    expect(parseDollarRange("from $38.50")).toEqual([3850, 3850]);
    expect(parseDollarRange("$10–20")).toEqual([1000, 2000]);
    expect(parseDollarRange("$10 - $20")).toEqual([1000, 2000]);
    expect(parseDollarRange("free")).toBeNull();
    expect(parseDollarRange(undefined)).toBeNull();
  });
  it("skips unpriced results and tolerates junk", () => {
    expect(eventsFromSerp({ events_results: [{ title: "x" }, { nope: 1 }] })).toEqual([]);
    expect(placesFromSerp({ local_results: [{ title: "x", price: "free" }] })).toEqual([]);
    expect(placesFromSerp(null)).toEqual([]);
    expect(placesFromSerp({ local_results: [{ title: "x", price: "$$$$" }] })[0]).toMatchObject({ lowCents: 6000, highCents: 12000, source: "level" });
  });
  it("resolves 'Nov 7' to the next such date on or after asOf", () => {
    expect(resolveMonthDay("Nov 7", "2026-10-25")).toBe("2026-11-07");
    expect(resolveMonthDay("Jan 3", "2026-10-25")).toBe("2027-01-03");
    expect(resolveMonthDay("Oct 25", "2026-10-25")).toBe("2026-10-25");
    expect(resolveMonthDay("someday", "2026-10-25")).toBeNull();
    expect(resolveMonthDay(null, "2026-10-25")).toBeNull();
  });
});
