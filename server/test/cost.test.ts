// RAG history + cold-start web cost steps (DESIGN 6c). No network: fake search, fake LLM clients, replay fixtures.
import { describe, expect, it } from "vitest";
import { pickPerPersonCents, quotePerPersonCents } from "../src/domain/ragCost";
import { ragHistoryCost, ragQuery, webColdStartCost } from "../src/pipeline/cost";
import type { GroundedClient, LlmClient } from "../src/llm";
import type { MessageHit, MessageSearch, SearchOptions } from "../src/pipeline/retrieval";
import { testDb } from "./helpers";

const hit = (messageId: string, body: string, score = 0.9): MessageHit => ({
  messageId, threadId: "t", senderId: "p_alex", body, sentAt: "2026-09-21T13:04:00Z", score,
});
const jsonClient = (responses: unknown[]): LlmClient & { calls: number; prompts: string[] } => ({
  calls: 0,
  prompts: [],
  async generateJson(prompt) {
    this.prompts.push(prompt);
    return JSON.stringify(responses[this.calls++]);
  },
});
const gen = (client: LlmClient) => ({ mode: "live" as const, client, model: "test-model", backoffMs: 1 });
const karaoke = {
  merchant: null, description: "Karaoke at Ego's", date: "2026-10-03", headcount: 3, contextMessageIds: ["own1", "own2"],
};

describe("pickPerPersonCents (pure)", () => {
  it("per-person quote wins; total / stated headcount is computed in code (rounded)", () => {
    expect(quotePerPersonCents({ messageId: "a", perPersonDollars: 20, relevance: "same_venue" })).toBe(2000);
    expect(quotePerPersonCents({ messageId: "a", totalDollars: 100, headcountStated: 3, relevance: "same_venue" })).toBe(3333);
    expect(quotePerPersonCents({ messageId: "a", totalDollars: 100, relevance: "same_venue" })).toBeNull();
    expect(quotePerPersonCents({ messageId: "a", perPersonDollars: 0, relevance: "same_venue" })).toBeNull();
  });
  it("same_venue is preferred over similar_event; unrelated and unknown ids are ignored", () => {
    const quotes = [
      { messageId: "a", perPersonDollars: 50, relevance: "similar_event" as const },
      { messageId: "b", perPersonDollars: 20, relevance: "same_venue" as const },
      { messageId: "c", perPersonDollars: 1, relevance: "unrelated" as const },
      { messageId: "ghost", perPersonDollars: 99, relevance: "same_venue" as const },
    ];
    expect(pickPerPersonCents(quotes, new Set(["a", "b", "c"]))).toMatchObject({ perPersonCents: 2000, evidenceMessageId: "b", relevance: "same_venue" });
    expect(pickPerPersonCents(quotes.slice(0, 1), new Set(["a"]))).toMatchObject({ perPersonCents: 5000, relevance: "similar_event" });
    expect(pickPerPersonCents([quotes[2]], new Set(["c"]))).toBeNull();
  });
  it("median across quotes (even count floors); evidence = quote nearest the median", () => {
    const q = (id: string, d: number) => ({ messageId: id, perPersonDollars: d, relevance: "same_venue" as const });
    expect(pickPerPersonCents([q("a", 10), q("b", 30), q("c", 25)])).toMatchObject({ perPersonCents: 2500, evidenceMessageId: "c", used: 3 });
    expect(pickPerPersonCents([q("a", 10), q("b", 25)])).toMatchObject({ perPersonCents: 1750 });
  });
});

describe("ragHistoryCost", () => {
  it("queries before the event date, excluding its own messages, k=8; same_venue quote x headcount", async () => {
    const db = await testDb();
    let seen: { q: string; o?: SearchOptions } | undefined;
    const search: MessageSearch = async (_db, q, o) => ((seen = { q, o }), [hit("m1", "Ego's was like $20 a head last time"), hit("m2", "rent is due")]);
    const client = jsonClient([{
      quotes: [
        { messageId: "m1", perPersonDollars: 20, relevance: "same_venue", text: "$20 a head" },
        { messageId: "m2", totalDollars: 900, relevance: "unrelated", text: "rent" },
      ],
    }]);
    const r = await ragHistoryCost(db, karaoke, { search, llm: gen(client) });
    expect(r).toEqual({ amountCents: 6000, perPersonCents: 2000, evidenceMessageId: "m1", relevance: "same_venue", quotesUsed: 1 });
    expect(seen!.o).toMatchObject({ k: 8, before: "2026-10-03", excludeMessageIds: ["own1", "own2"] });
    expect(seen!.q).toContain("Karaoke");
    expect(seen!.q).not.toMatch(/\bat\b/);
    expect(client.prompts[0]).toContain("Ego's was like $20 a head last time");
  });

  it("total / stated headcount is done in code; prefers same_venue over a similar_event", async () => {
    const db = await testDb();
    const search: MessageSearch = async () => [hit("a", "tab was $90 for the three of us at Ego's"), hit("b", "other karaoke place $50 each")];
    const client = jsonClient([{
      quotes: [
        { messageId: "a", totalDollars: 90, headcountStated: 3, relevance: "same_venue", text: "$90 for the three of us" },
        { messageId: "b", perPersonDollars: 50, relevance: "similar_event", text: "$50 each" },
      ],
    }]);
    const r = await ragHistoryCost(db, { ...karaoke, headcount: 4 }, { search, llm: gen(client) });
    expect(r).toMatchObject({ perPersonCents: 3000, amountCents: 12000, evidenceMessageId: "a" });
  });

  it("no hits -> null and the LLM is never called", async () => {
    const db = await testDb();
    const client = jsonClient([]);
    expect(await ragHistoryCost(db, karaoke, { search: async () => [], llm: gen(client) })).toBeNull();
    expect(client.calls).toBe(0);
  });

  it("hits but no usable quote -> null", async () => {
    const db = await testDb();
    const client = jsonClient([{ quotes: [{ messageId: "a", perPersonDollars: 5, relevance: "unrelated", text: "x" }] }]);
    expect(await ragHistoryCost(db, karaoke, { search: async () => [hit("a", "x")], llm: gen(client) })).toBeNull();
  });

  it("replays the seed fixture; a fixture quote whose id is not among the hits is ignored", async () => {
    const db = await testDb();
    const priceId = "weekendcrew_weekend1:1789995840000:1";
    const withPrice: MessageSearch = async () => [hit("junk", "unrelated"), hit(priceId, "Ego's was like $20 a head last time")];
    const r = await ragHistoryCost(db, { ...karaoke, description: "Karaoke at Ego's" }, { search: withPrice, llm: { mode: "replay" } });
    expect(r).toMatchObject({ amountCents: 6000, evidenceMessageId: priceId });
    const db2 = await testDb();
    const without: MessageSearch = async () => [hit("junk", "unrelated")];
    expect(await ragHistoryCost(db2, karaoke, { search: without, llm: { mode: "replay" } })).toBeNull();
  });

  it("ragQuery uses merchant when known, else description words without stopwords", () => {
    expect(ragQuery({ merchant: "Uchi", eventType: "dinner" })).toBe("Uchi dinner cost per person price");
    expect(ragQuery({ merchant: null, description: "Kayaking at Lady Bird Lake" })).toBe("Kayaking Lady Bird Lake cost per person price");
  });
});

describe("webColdStartCost", () => {
  const sources = [
    { uri: "https://vertexaisearch.example/redirect/abc", title: "rowingdock.com" },
    { uri: "https://reviews.example/kayak", title: "Kayak review" },
  ];
  const grounded = (result: { text: string; sources: typeof sources }): GroundedClient & { calls: number } => ({
    calls: 0,
    async search() {
      this.calls++;
      return result;
    },
  });
  const q = { merchant: null, eventType: null, description: "Kayaking at Lady Bird Lake" };

  it("grounded call + extraction; URL comes from the grounding sources; cached by venue + event type", async () => {
    const db = await testDb();
    const g = grounded({ text: "Single kayaks rent for about $30 per person per hour.", sources });
    const client = jsonClient([{ perPersonDollars: 30, sourceIndex: 1, confidence: 0.6 }]);
    const cold = webColdStartCost(db, { mode: "live", client, grounded: g, model: "test-model", backoffMs: 1 });
    const r = await cold(q);
    expect(r).toEqual({ perPersonCents: 3000, sourceUrl: "https://reviews.example/kayak", sourceTitle: "Kayak review", confidence: 0.6 });
    expect(client.prompts[0]).toContain("1: Kayak review https://reviews.example/kayak");
    expect(await cold({ ...q, description: "kayaking at lady bird lake " })).toEqual(r);
    expect([g.calls, client.calls]).toEqual([1, 1]);
  });

  it("no grounding source -> null without an extraction call; bad source index / no price -> null", async () => {
    const db = await testDb();
    const client = jsonClient([{ perPersonDollars: 30, confidence: 0.6 }]);
    const none = webColdStartCost(db, { mode: "live", client, grounded: grounded({ text: "about $30", sources: [] }), model: "m" });
    expect(await none(q)).toBeNull();
    expect(client.calls).toBe(0);
    const noIdx = webColdStartCost(db, { mode: "live", client, grounded: grounded({ text: "about $30", sources }), model: "m" });
    expect(await noIdx(q)).toBeNull(); // extraction cited no source
    const db2 = await testDb();
    const noPrice = webColdStartCost(db2, {
      mode: "live", client: jsonClient([{ sourceIndex: 0, confidence: 0.2 }]), grounded: grounded({ text: "no idea", sources }), model: "m",
    });
    expect(await noPrice(q)).toBeNull();
  });

  it("neither merchant nor description -> null", async () => {
    const db = await testDb();
    expect(await webColdStartCost(db, { mode: "replay" })({ merchant: null })).toBeNull();
  });

  it("replays server/test/fixtures/llm/webCost/<slug>.json; a miss throws", async () => {
    const db = await testDb();
    const cold = webColdStartCost(db, { mode: "replay" });
    expect(await cold(q)).toMatchObject({ perPersonCents: 2500, sourceUrl: expect.stringMatching(/^https:\/\//), confidence: 0.55 });
    await expect(cold({ merchant: "Nowhere Nonexistent" })).rejects.toThrow(/replay miss.*webCost/);
  });
});
