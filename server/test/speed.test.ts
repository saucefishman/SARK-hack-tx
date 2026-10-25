// Speed-ups: reasoning level plumbing, mapLimit, and LLM-call skip rules.
import { beforeAll, describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import type { Db } from "../src/db/pool";
import { chatRequestBody, createMuseClient, createMuseGroundedClient, groundedRequestBody, reasoningParams } from "../src/llm/muse";
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

describe("LLM_REASONING", () => {
  it("config default is low; maps to each API's reasoning parameter; none/max are rejected", () => {
    expect(getConfig().LLM_REASONING).toBe("low");
    expect(getConfig().LLM_CONCURRENCY).toBe(4);
    expect(reasoningParams("chat", "low")).toEqual({ reasoning_effort: "low" });
    expect(reasoningParams("chat", "high")).toEqual({ reasoning_effort: "high" });
    expect(reasoningParams("responses", "low")).toEqual({ reasoning: { effort: "low" } });
    expect(reasoningParams("chat", "default")).toEqual({});
    expect(reasoningParams("responses", "default")).toEqual({});
    expect(() => getConfig({ LLM_REASONING: "none" as never })).toThrow(); // HTTP 400 on Muse Spark
    expect(() => getConfig({ LLM_REASONING: "max" as never })).toThrow(); // not on contributor models
  });
  it("reaches the request body from both clients (and is omitted for default)", async () => {
    const seen: { url: string; body: any }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      const res = url.endsWith("/responses")
        ? { status: "completed", output: [] }
        : { choices: [{ finish_reason: "stop", message: { content: "{}" } }] };
      return new Response(JSON.stringify(res), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    await createMuseClient({ apiKey: "k", model: "m", baseUrl: "http://muse.test/v1", fetch }).generateJson("p", { type: "object" });
    await createMuseGroundedClient({ apiKey: "k", model: "m", baseUrl: "http://muse.test/v1", fetch }).search("p");
    expect(seen[0].url).toBe("http://muse.test/v1/chat/completions");
    expect(seen[0].body.reasoning_effort).toBe("low");
    expect(seen[0].body.response_format.json_schema.schema).toEqual({ type: "object" });
    expect(seen[1].url).toBe("http://muse.test/v1/responses");
    expect(seen[1].body.reasoning).toEqual({ effort: "low" });
    expect(seen[1].body.tools).toEqual([{ type: "web_search" }]);
    expect(chatRequestBody("p", {}, "m", "default")).not.toHaveProperty("reasoning_effort");
    expect(groundedRequestBody("p", "m", "default")).not.toHaveProperty("reasoning");
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
