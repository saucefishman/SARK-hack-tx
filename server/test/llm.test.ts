import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { testDb } from "./helpers";
import {
  cacheKey,
  canonicalJson,
  generateStructured,
  mergeDay,
  messageDay,
  slug,
  txnSocial,
  validateMergeGroups,
  type LlmClient,
  type MergeDayInput,
} from "../src/llm";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/llm-unit");
const txnIn = { txnId: "T-1", merchant: "Uchi", category: "restaurant", amountDollars: 80, date: "2026-03-12", siblings: [] };
const fast = { backoffMs: 1, fixturesDir, model: "test-model" };

function fake(responses: (string | Error)[]): LlmClient & { calls: number } {
  return {
    calls: 0,
    async generateJson() {
      const r = responses[this.calls++]!;
      if (r instanceof Error) throw r;
      return r;
    },
  };
}
const ok = '{"looksSocial":false,"reason":"x"}';

describe("cache key", () => {
  it("ignores key order, depends on model/version", () => {
    const a = canonicalJson({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: 2 } });
    expect(a).toBe(canonicalJson({ a: { c: 2, d: [1, { x: 2, y: 1 }] }, b: 1 }));
    expect(cacheKey("p", "1", "m", { a: 1, b: 2 })).toBe(cacheKey("p", "1", "m", { b: 2, a: 1 }));
    expect(cacheKey("p", "1", "m", {})).not.toBe(cacheKey("p", "2", "m", {}));
    expect(cacheKey("p", "1", "m", {})).not.toBe(cacheKey("p", "1", "n", {}));
  });
  it("slug", () => expect(slug("Alex & Co / 2")).toBe("alex-co-2"));
});

describe("replay", () => {
  it("reads fixture and caches it in llm_cache", async () => {
    const db = await testDb();
    const out = await generateStructured(db, txnSocial, txnIn, { ...fast, mode: "replay" });
    expect(out.looksSocial).toBe(true);
    const { rows } = await db.query("SELECT prompt_id FROM llm_cache");
    expect(rows).toHaveLength(1);
    // served from cache even with a bad fixtures dir
    const again = await generateStructured(db, txnSocial, txnIn, { ...fast, mode: "replay", fixturesDir: "/nonexistent" });
    expect(again).toEqual(out);
  });
  it("miss throws a clear error", async () => {
    const db = await testDb();
    const p = generateStructured(db, txnSocial, { ...txnIn, txnId: "nope" }, { ...fast, mode: "replay" });
    await expect(p).rejects.toThrow(/promptId=txnSocial fixtureKey=nope.*txnSocial\/nope\.json.*Input:/s);
  });
});

describe("live", () => {
  it("success is cached", async () => {
    const db = await testDb();
    const client = fake([ok]);
    const o = { ...fast, mode: "live" as const, client };
    await generateStructured(db, txnSocial, txnIn, o);
    await generateStructured(db, txnSocial, txnIn, o);
    expect(client.calls).toBe(1);
  });
  it("repairs once after invalid output", async () => {
    const db = await testDb();
    const client = fake(['{"looksSocial":"maybe"}', '```json\n{"looksSocial":true,"reason":null,"x":1}\n```', ok]);
    // reason:null is stripped -> missing -> invalid again -> throws
    await expect(generateStructured(db, txnSocial, txnIn, { ...fast, mode: "live", client })).rejects.toThrow(/after repair/);
    expect(client.calls).toBe(2);
    const c2 = fake(["not json", ok]);
    const v = await generateStructured(db, txnSocial, { ...txnIn, txnId: "T-2" }, { ...fast, mode: "live", client: c2 });
    expect(v.looksSocial).toBe(false);
    expect(c2.calls).toBe(2);
  });
  it("retries 429 then succeeds; gives up after max tries", async () => {
    const db = await testDb();
    const err = Object.assign(new Error("rate"), { status: 429 });
    const c1 = fake([err, err, ok]);
    await generateStructured(db, txnSocial, txnIn, { ...fast, mode: "live", client: c1 });
    expect(c1.calls).toBe(3);
    const c2 = fake([err, err, err, err, err]);
    await expect(
      generateStructured(db, txnSocial, { ...txnIn, txnId: "T-3" }, { ...fast, mode: "live", client: c2 }),
    ).rejects.toThrow("rate");
    expect(c2.calls).toBe(4);
    const bad = Object.assign(new Error("bad"), { status: 400 });
    const c3 = fake([bad]);
    await expect(
      generateStructured(db, txnSocial, { ...txnIn, txnId: "T-4" }, { ...fast, mode: "live", client: c3 }),
    ).rejects.toThrow("bad");
    expect(c3.calls).toBe(1);
  });
  it("mergeDay validation triggers repair", async () => {
    const db = await testDb();
    const input = mergeIn();
    const bad = JSON.stringify({ groups: [{ protoEventIds: ["a"], description: "d", attendeeIds: [], payers: [], confidence: 0.5 }] });
    const good = JSON.stringify({ groups: [{ protoEventIds: ["a", "b"], description: "d", attendeeIds: ["p_me"], payers: [], confidence: 0.9 }] });
    const client = fake([bad, good]);
    const out = await generateStructured(db, mergeDay, input, { ...fast, mode: "live", client });
    expect(out.groups).toHaveLength(1);
    expect(client.calls).toBe(2);
  });
});

function mergeIn(): MergeDayInput {
  return {
    date: "2026-03-12",
    people: [{ id: "p_me", name: "Me" }],
    protoEvents: [
      { id: "a", source: "txn", peopleIds: ["p_me"], details: {} },
      { id: "b", source: "message", peopleIds: ["p_me"], details: {} },
    ],
  };
}

describe("validateMergeGroups", () => {
  const g = (ids: string[]) => ({ protoEventIds: ids, description: "d", attendeeIds: [], payers: [], confidence: 1 });
  it("accepts exact cover", () => {
    expect(() => validateMergeGroups(mergeIn(), { groups: [g(["a"]), g(["b"])] })).not.toThrow();
  });
  it("rejects missing, duplicate, unknown", () => {
    expect(() => validateMergeGroups(mergeIn(), { groups: [g(["a"])] })).toThrow(/"b" is missing/);
    expect(() => validateMergeGroups(mergeIn(), { groups: [g(["a", "b"]), g(["b"])] })).toThrow(/appears 2 times/);
    expect(() => validateMergeGroups(mergeIn(), { groups: [g(["a", "b", "z"])] })).toThrow(/unknown/);
  });
});

describe("prompts", () => {
  it("render includes input and fixtureKey is stable", () => {
    const i = {
      threadId: "Alex Thread",
      threadTitle: "Alex",
      date: "2026-03-12",
      people: [{ id: "p_me", name: "Me" }],
      messages: [{ id: "m1", senderId: "p_me", senderName: "Me", time: "10:00", text: "hi" }],
    };
    expect(messageDay.render(i)).toContain('"m1"');
    expect(messageDay.fixtureKey(i)).toBe("2026-03-12__alex-thread");
  });
});
