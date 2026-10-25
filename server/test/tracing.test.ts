// Tracing: off by default (passthrough), and when on, traced functions still return the same results while the
// LangSmith client is stubbed so nothing leaves the machine.
import { Client } from "langsmith";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateStructured, type LlmClient } from "../src/llm";
import {
  annotateRun, flushTraces, isTraceableFunction, runTraced, setTracingClient, traced, tracingEnabled, wrapGenAI,
} from "../src/obs/tracing";
import { searchMessages } from "../src/pipeline/retrieval";
import { localEmbedder } from "../src/llm/embed";
import { testDb } from "./helpers";

const KEYS = ["LANGSMITH_TRACING", "LANGSMITH_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => KEYS.forEach((k) => (saved[k] = process.env[k])));
afterEach(() => {
  KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  setTracingClient(undefined);
  vi.restoreAllMocks();
});

/** Enables tracing with a client whose fetch is a recording stub (and fails the test on real network use). */
function enable() {
  process.env.LANGSMITH_TRACING = "true";
  process.env.LANGSMITH_API_KEY = "test-key";
  const calls: string[] = [];
  const bodies: string[] = [];
  const stubFetch = (async (url: unknown, init?: { body?: unknown }) => {
    calls.push(String(url));
    const b = init?.body;
    bodies.push(typeof b === "string" ? b : b instanceof Blob ? await b.text() : b ? Buffer.from(b as ArrayBuffer).toString() : "");
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("real network call attempted");
  }) as typeof fetch;
  setTracingClient(new Client({ apiKey: "test-key", apiUrl: "http://langsmith.invalid", fetchImplementation: stubFetch, autoBatchTracing: false }));
  return { calls, bodies, restore: () => (globalThis.fetch = realFetch) };
}

describe("tracing disabled (default)", () => {
  it("is a passthrough", async () => {
    delete process.env.LANGSMITH_TRACING;
    delete process.env.LANGSMITH_API_KEY;
    expect(tracingEnabled()).toBe(false);
    const fn = async (x: number) => x + 1;
    expect(traced("t", fn)).toBe(fn);
    expect(isTraceableFunction(traced("t", fn))).toBe(false);
    const ai = { models: { generateContent: async () => 1, generateContentStream: async () => 1 } };
    expect(wrapGenAI(ai)).toBe(ai);
    expect(await runTraced("r", {}, async () => 7)).toBe(7);
    annotateRun({ a: 1 }); // no-op
    await expect(flushTraces()).resolves.toBeUndefined();
  });

  it("needs both the flag and a key", () => {
    process.env.LANGSMITH_TRACING = "true";
    delete process.env.LANGSMITH_API_KEY;
    expect(tracingEnabled()).toBe(false);
    process.env.LANGSMITH_API_KEY = "k";
    expect(tracingEnabled()).toBe(true);
    process.env.LANGSMITH_TRACING = "false";
    expect(tracingEnabled()).toBe(false);
  });
});

describe("tracing enabled (client stubbed)", () => {
  it("traced() returns a traceable fn with unchanged results; flush delivers to the stub only", async () => {
    const { calls, restore } = enable();
    try {
      const fn = async (x: number) => x * 2;
      const t = traced("double", fn, { runType: "tool", metadata: { a: 1 }, tags: ["x"] });
      expect(isTraceableFunction(t)).toBe(true);
      expect(await t(21)).toBe(42);
      expect(await runTraced("child", { n: 1 }, async () => "ok")).toBe("ok");
      await flushTraces();
      expect(calls.every((u) => u.startsWith("http://langsmith.invalid"))).toBe(true);
      expect(calls.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("generateStructured and searchMessages give identical results when traced", async () => {
    const db = await testDb();
    const prompt = {
      id: "tracingTest",
      version: "1",
      schema: z.object({ ok: z.boolean() }),
      render: () => "hi",
      fixtureKey: () => "k",
    };
    const client: LlmClient = { generateJson: async () => '{"ok":true}' };
    const plain = await generateStructured(db, prompt, {}, { mode: "live", client, model: "m1" });
    const { calls, bodies, restore } = enable();
    try {
      const traced1 = await generateStructured(db, prompt, {}, { mode: "live", client, model: "m2" });
      const cached = await generateStructured(db, prompt, {}, { mode: "live", client, model: "m2" });
      expect(traced1).toEqual(plain);
      expect(cached).toEqual(plain);
      expect(await searchMessages(db, "anything", { embedder: localEmbedder() })).toEqual([]);
      await flushTraces();
      expect(calls.length).toBeGreaterThan(0);
      const all = bodies.join("\n");
      expect(all).toContain("llm:tracingTest");
      expect(all).toMatch(/"source":"live"/);
      expect(all).toMatch(/"source":"cache"/);
    } finally {
      restore();
    }
  });
});
