// Speed-ups: thinking level plumbing, mapLimit, and LLM-call skip rules.
import { ThinkingLevel } from "@google/genai";
import { beforeAll, describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import type { Db } from "../src/db/pool";
import { createGeminiClient, generationConfig, thinkingConfig } from "../src/llm/gemini";
import { createGroundedClient, groundedConfig } from "../src/llm/webSearch";
import type { LlmClient } from "../src/llm";
import { detectRepayments } from "../src/pipeline/attribution";
import { mergeEvents, singleProtoGroup } from "../src/pipeline/merge";
import { runPipeline } from "../src/pipeline/run";
import { sourcesFromDir } from "../src/sources";
import { mapLimit } from "../src/util/mapLimit";
import { testDb } from "./helpers";
import { writeTempSeed } from "./tempSeed";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapLimit", () => {
  it("preserves order and respects the concurrency bound", async () => {
    let active = 0, peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
      active++; peak = Math.max(peak, active);
      await sleep(n * 3);
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });
  it("handles empty input and limit larger than input", async () => {
    expect(await mapLimit([], 4, async (x) => x)).toEqual([]);
    expect(await mapLimit([1, 2], 10, async (x) => x + 1)).toEqual([2, 3]);
  });
  it("propagates the first error and starts no new work after it", async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5, 6], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    expect(started).toEqual([1, 2]);
  });
});

describe("GEMINI_THINKING", () => {
  it("config default is low; enum maps to SDK ThinkingLevel", () => {
    expect(getConfig().GEMINI_THINKING).toBe("low");
    expect(getConfig().LLM_CONCURRENCY).toBe(4);
    expect(thinkingConfig("low")).toEqual({ thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } });
    expect(thinkingConfig("high")).toEqual({ thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } });
    expect(thinkingConfig("default")).toEqual({});
    expect(() => getConfig({ GEMINI_THINKING: "minimal" as never })).toThrow();
  });
  it("reaches generateContent from both clients (and is omitted for default)", async () => {
    const seen: any[] = [];
    const ai = { models: { generateContent: async (req: any) => (seen.push(req.config), { text: "{}", candidates: [] }) } } as any;
    await createGeminiClient("k", "m", ai).generateJson("p", { type: "object" });
    await createGroundedClient("k", "m", ai).search("p");
    expect(seen[0].thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(seen[0].responseJsonSchema).toEqual({ type: "object" });
    expect(seen[1].thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(seen[1].tools).toEqual([{ googleSearch: {} }]);
    expect(generationConfig({}, "default")).not.toHaveProperty("thinkingConfig");
    expect(groundedConfig("default")).not.toHaveProperty("thinkingConfig");
  });
});

describe("LLM call skips", () => {
  const dir = writeTempSeed();
  const sources = sourcesFromDir(dir);
  let db: Db;
  beforeAll(async () => {
    db = await testDb();
    await runPipeline(db, { llmMode: "replay", sources });
  });

  const counting = () => {
    const c: LlmClient & { calls: number } = { calls: 0, async generateJson() { c.calls++; return '{"repayments":[]}'; } };
    return c;
  };
  const live = (client: LlmClient) => ({ llmMode: "live" as const, llm: { client, model: "skip-test" } });

  it("single-proto days skip mergeDay and match the LLM path's events and payers", async () => {
    const snap = async (d: Db) => ({
      events: (await d.query("SELECT id, date, time, attendee_ids, total_cents, source_count, anchor_txn_id, context_message_ids FROM event ORDER BY id")).rows,
      payers: (await d.query("SELECT * FROM event_payer ORDER BY event_id, person_id")).rows,
    });
    const skipped = await mergeEvents(db, { llmMode: "replay" });
    expect(skipped.llmSkipped).toBe(2);
    const a = await snap(db);
    const full = await mergeEvents(db, { llmMode: "replay", noSkip: true });
    expect(full.llmSkipped).toBe(0);
    expect(full.llmCalls).toBe(skipped.llmCalls + 2);
    expect(await snap(db)).toEqual(a);
  });

  it("singleProtoGroup rules", () => {
    const known = new Set(["p_me", "p_sam"]);
    const txns = new Map([["t1", { payer_id: "p_me" }], ["t2", { payer_id: "p_sam" }]]);
    const p = (o: object) => ({ id: "pe1", source: "txn" as const, time: null, description: "X purchase", people_ids: ["p_me"], details: { txnId: "t1" }, ...o });
    expect(singleProtoGroup([p({})], txns, known)!.groups[0]).toMatchObject({ protoEventIds: ["pe1"], attendeeIds: ["p_me"], payers: [] });
    expect(singleProtoGroup([p({ details: { txnId: "t2" } })], txns, known)).toBeNull(); // friend-paid txn: ambiguous
    expect(singleProtoGroup([p({}), p({ id: "pe2" })], txns, known)).toBeNull();
    expect(singleProtoGroup([p({ source: "calendar" })], txns, known)).toBeNull();
    expect(singleProtoGroup([p({ source: "message", details: {} })], txns, known)).toBeNull(); // no payer info: LLM may assume one
    const m = singleProtoGroup([p({ source: "message", details: { payers: [{ personId: "p_sam", amountDollars: 40 }, { personId: "p_me" }] } })], txns, known)!;
    expect(m.groups[0]!.payers).toEqual([
      { personId: "p_sam", amountDollars: 40, basis: "confirmed" },
      { personId: "p_me", basis: "estimated" },
    ]);
  });

  it("repayments: one call per thread with outstanding debts and later messages, none otherwise", async () => {
    const d1 = await testDb();
    await runPipeline(d1, { llmMode: "replay", sources });
    const c = counting();
    const base = await detectRepayments(d1, live(c));
    expect(base.llmCalls).toBeGreaterThan(0);
    expect(c.calls).toBe(base.llmCalls);

    // no outstanding debts at all -> no calls
    const none = counting();
    await d1.query("UPDATE event SET is_relevant = false");
    const r1 = await detectRepayments(d1, { llmMode: "live", llm: { client: none, model: "skip-test-2" } });
    expect(none.calls).toBe(0);
    expect(r1.llmCalls).toBe(0);
    expect(r1.llmSkipped).toBe(base.llmCalls + base.llmSkipped);
  });

  it("repayments: threads with no messages after the earliest relevant event are skipped", async () => {
    const d2 = await testDb();
    await runPipeline(d2, { llmMode: "replay", sources });
    await d2.query("UPDATE event SET date = '2099-01-01'");
    const c = counting();
    const r = await detectRepayments(d2, live(c));
    expect(c.calls).toBe(0);
    expect(r.llmSkipped).toBeGreaterThan(0);
  });
});
