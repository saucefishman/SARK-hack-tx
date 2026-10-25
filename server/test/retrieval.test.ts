// Retrieval: local embedder, embedding cache, embed stage, searchMessages (pgvector + JS fallback), live embedder (fake client).
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/pool";
import { EMBED_DIMS, embedTexts, geminiEmbedder, localEmbedder, type EmbedClient, type Embedder } from "../src/llm/embed";
import { embedMessages, hasVectorColumn } from "../src/pipeline/embed";
import { searchMessages } from "../src/pipeline/retrieval";
import { testDb } from "./helpers";

const norm = (v: number[]) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));

async function seedMessages(db: Db) {
  await db.query("INSERT INTO person (id, display_name, is_user) VALUES ('p1', 'Pat', false)");
  const msgs: [string, string, string][] = [
    ["m1", "2026-01-01T10:00:00Z", "karaoke was $30 per person last night, so fun"],
    ["m2", "2026-01-02T10:00:00Z", "the karaoke cost about $25 a head"],
    ["m3", "2026-01-03T10:00:00Z", "did you finish the chemistry homework"],
    ["m4", "2026-03-01T10:00:00Z", "karaoke cost per person was $40 this time"],
    ["m5", "2026-01-04T10:00:00Z", "see you at the gym tomorrow morning"],
  ];
  for (const [id, at, body] of msgs) {
    await db.query("INSERT INTO message (id, thread_id, sender_id, sender_name, sent_at, body) VALUES ($1, 't1', 'p1', 'Pat', $2, $3)", [id, at, body]);
  }
}

describe("localEmbedder", () => {
  it("is deterministic, 768-dim and L2-normalized", async () => {
    const e = localEmbedder();
    const [a] = await e.embed(["karaoke cost per person"]);
    const [b] = await e.embed(["karaoke cost per person"]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBED_DIMS);
    expect(norm(a!)).toBeCloseTo(1, 6);
  });
});

describe("embedTexts cache", () => {
  it("only calls the embedder for misses", async () => {
    const db = await testDb();
    const inner = localEmbedder();
    let calls = 0;
    const counting: Embedder = { ...inner, async embed(t) { calls += t.length; return inner.embed(t); } };
    const first = await embedTexts(db, ["alpha", "beta", "alpha"], counting);
    expect(calls).toBe(2);
    const second = await embedTexts(db, ["alpha", "beta"], counting);
    expect(calls).toBe(2);
    expect(second[0]).toEqual(first[0]);
    expect((await db.query("SELECT 1 FROM embedding_cache")).rows).toHaveLength(2);
  });
});

describe("embedMessages", () => {
  it("is idempotent and fills both columns", async () => {
    const db = await testDb();
    await seedMessages(db);
    expect(await hasVectorColumn(db)).toBe(true);
    const embedder = localEmbedder();
    expect(await embedMessages(db, { embedder })).toEqual({ embedded: 5, skipped: 0 });
    expect(await embedMessages(db, { embedder })).toEqual({ embedded: 0, skipped: 5 });
    const { rows } = await db.query<{ n: string }>("SELECT count(*) n FROM message WHERE embedding IS NOT NULL AND embedding_vec IS NOT NULL AND embedding_model = $1", [embedder.model]);
    expect(Number(rows[0]!.n)).toBe(5);
    // a different model re-embeds everything
    const other: Embedder = { ...embedder, model: "other" };
    expect((await embedMessages(db, { embedder: other })).embedded).toBe(5);
  });
});

describe.each([
  ["pgvector", true],
  ["JS fallback", false],
])("searchMessages (%s)", (_name, useVector) => {
  let db: Db;
  const embedder = localEmbedder();
  const search = (q: string, o = {}) => searchMessages(db, q, { embedder, useVector, ...o });
  beforeAll(async () => {
    db = await testDb();
    await seedMessages(db);
    await embedMessages(db, { embedder });
  });

  it("ranks the related message first", async () => {
    const hits = await search("karaoke cost per person");
    expect(hits[0]!.messageId).toMatch(/^m[124]$/);
    expect(hits.slice(0, 3).map((h) => h.messageId).sort()).toEqual(["m1", "m2", "m4"]);
    expect(hits[0]!.score).toBeGreaterThan(hits.at(-1)!.score);
  });

  it("respects before, excludeMessageIds and k", async () => {
    const before = await search("karaoke cost per person", { before: "2026-02-01" });
    expect(before.map((h) => h.messageId)).not.toContain("m4");
    const ex = await search("karaoke cost per person", { excludeMessageIds: ["m1", "m4"] });
    expect(ex[0]!.messageId).toBe("m2");
    expect(ex.map((h) => h.messageId)).not.toContain("m1");
    expect(await search("karaoke", { k: 1 })).toHaveLength(1);
  });

  it("is deterministic", async () => {
    expect(await search("karaoke cost per person")).toEqual(await search("karaoke cost per person"));
  });
});

describe("pgvector and JS paths agree", () => {
  it("same ranking", async () => {
    const db = await testDb();
    await seedMessages(db);
    const embedder = localEmbedder();
    await embedMessages(db, { embedder });
    const a = await searchMessages(db, "gym morning", { embedder, useVector: true });
    const b = await searchMessages(db, "gym morning", { embedder, useVector: false });
    expect(a.map((h) => h.messageId)).toEqual(b.map((h) => h.messageId));
    expect(a[0]!.score).toBeCloseTo(b[0]!.score, 4);
  });
});

describe("geminiEmbedder (fake client)", () => {
  const fake = () => {
    const calls: { n: number; model: string; dims?: number }[] = [];
    let fail = 0;
    const client: EmbedClient = {
      async embedContent(p) {
        if (fail-- > 0) throw Object.assign(new Error("unavailable"), { status: 503 });
        calls.push({ n: p.contents.length, model: p.model, dims: p.config?.outputDimensionality });
        return { embeddings: p.contents.map(() => ({ values: new Array(EMBED_DIMS).fill(3) })) };
      },
    };
    return { client, calls, failNext: (n: number) => (fail = n) };
  };

  it("batches at 100, requests 768 dims and normalizes", async () => {
    const { client, calls } = fake();
    const e = geminiEmbedder({ client, model: "m" });
    const out = await e.embed(Array.from({ length: 250 }, (_, i) => `t${i}`));
    expect(calls.map((c) => c.n)).toEqual([100, 100, 50]);
    expect(calls[0]).toMatchObject({ model: "m", dims: 768 });
    expect(out).toHaveLength(250);
    expect(norm(out[0]!)).toBeCloseTo(1, 6);
  });

  it("retries 5xx but not daily quota", async () => {
    const f = fake();
    f.failNext(1);
    expect(await geminiEmbedder({ client: f.client, model: "m", backoffMs: 1 }).embed(["a"])).toHaveLength(1);
    const quota: EmbedClient = { embedContent: async () => { throw Object.assign(new Error("429 PerDay quota"), { status: 429 }); } };
    await expect(geminiEmbedder({ client: quota, model: "m", backoffMs: 1 }).embed(["a"])).rejects.toThrow(/PerDay/);
  });
});
