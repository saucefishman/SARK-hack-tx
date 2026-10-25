// The ONE Gemini client: cached, record/replay, retrying, zod-validated structured output.
import { GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getConfig, REPO_ROOT } from "../config";
import type { Db } from "../db/pool";
import type { PromptDef } from "./types";

export interface LlmClient {
  /** Returns the raw model text (expected JSON). Throw errors carrying `.status` for HTTP failures. */
  generateJson(prompt: string, jsonSchema: object): Promise<string>;
}

export interface GenerateOptions {
  mode?: "live" | "replay";
  client?: LlmClient;
  /** Replay fixtures root (default server/test/fixtures/llm). */
  fixturesDir?: string;
  /** Model name for the cache key (default config GEMINI_MODEL). */
  model?: string;
  /** Max attempts on 429/5xx (default 4). */
  maxTries?: number;
  /** First backoff delay in ms, doubles each retry (default 1000). */
  backoffMs?: number;
}

export const DEFAULT_FIXTURES_DIR = path.join(REPO_ROOT, "server/test/fixtures/llm");

/** JSON with recursively sorted object keys, so key order never changes the cache key. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const body = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`);
    return `{${body.join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function cacheKey(promptId: string, version: string, model: string, input: unknown): string {
  return createHash("sha256")
    .update(promptId + version + model + canonicalJson(input))
    .digest("hex");
}

export function createGeminiClient(apiKey?: string, model?: string): LlmClient {
  const cfg = getConfig();
  const key = apiKey ?? cfg.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing (human task H3); use LLM_MODE=replay");
  const ai = new GoogleGenAI({ apiKey: key });
  const m = model ?? cfg.GEMINI_MODEL;
  return {
    async generateJson(prompt, jsonSchema) {
      const res = await ai.models.generateContent({
        model: m,
        contents: prompt,
        config: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: jsonSchema },
      });
      return res.text ?? "";
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryable(e: unknown): boolean {
  const status = (e as { status?: number; code?: number })?.status ?? (e as { code?: number })?.code;
  if (typeof status === "number") return status === 429 || status >= 500;
  return /\b(429|5\d\d)\b|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(String((e as Error)?.message ?? ""));
}

/** Gemini sometimes emits null for absent optionals; zod .optional() wants undefined. */
function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== null)
        .map(([k, x]) => [k, stripNulls(x)]),
    );
  }
  return v;
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(t);
}

async function callWithRetry(client: LlmClient, prompt: string, schema: object, o: GenerateOptions): Promise<string> {
  const max = o.maxTries ?? 4;
  const base = o.backoffMs ?? 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.generateJson(prompt, schema);
    } catch (e) {
      if (attempt >= max || !retryable(e)) throw e;
      await sleep(base * 2 ** (attempt - 1));
    }
  }
}

function previewInput(input: unknown): string {
  const s = JSON.stringify(input);
  return s.length > 300 ? `${s.slice(0, 300)}...` : s;
}

async function cacheGet<O>(db: Db, key: string, schema: z.ZodType<O>): Promise<O | undefined> {
  const { rows } = await db.query<{ response: unknown }>("SELECT response FROM llm_cache WHERE key = $1", [key]);
  if (!rows.length) return undefined;
  return schema.parse(rows[0]!.response);
}

async function cachePut(db: Db, key: string, model: string, promptId: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO llm_cache (key, model, prompt_id, response) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (key) DO UPDATE SET response = EXCLUDED.response, model = EXCLUDED.model`,
    [key, model, promptId, JSON.stringify(value)],
  );
}

export async function generateStructured<I, O>(
  db: Db,
  prompt: PromptDef<I, O>,
  input: I,
  opts: GenerateOptions = {},
): Promise<O> {
  const cfg = getConfig();
  const mode = opts.mode ?? cfg.LLM_MODE;
  const model = opts.model ?? cfg.GEMINI_MODEL;
  const key = cacheKey(prompt.id, prompt.version, model, input);

  const hit = await cacheGet(db, key, prompt.schema);
  if (hit !== undefined) return hit;

  if (mode === "replay") {
    const fixtureKey = prompt.fixtureKey(input);
    const file = path.join(opts.fixturesDir ?? DEFAULT_FIXTURES_DIR, prompt.id, `${fixtureKey}.json`);
    let raw: string | undefined;
    try {
      raw = await readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (raw === undefined) {
      throw new Error(
        `LLM replay miss: promptId=${prompt.id} fixtureKey=${fixtureKey}. ` +
          `No cache entry and no fixture; create ${file} with the response JSON. Input: ${previewInput(input)}`,
      );
    }
    const value = prompt.schema.parse(stripNulls(JSON.parse(raw)));
    runValidate(prompt, input, value);
    await cachePut(db, key, model, prompt.id, value);
    return value;
  }

  const client = opts.client ?? createGeminiClient(undefined, model);
  const jsonSchema = toJsonSchema(prompt.schema);
  const base = prompt.render(input);

  const attempt = async (text: string): Promise<O> => {
    const parsed = prompt.schema.parse(stripNulls(extractJson(text)));
    runValidate(prompt, input, parsed);
    return parsed;
  };

  const first = await callWithRetry(client, base, jsonSchema, opts);
  let value: O;
  try {
    value = await attempt(first);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const repairPrompt =
      `${base}\n\nYour previous response was invalid.\nPrevious response:\n${first}\n\nError:\n${msg}\n\n` +
      `Return corrected JSON only, matching the schema exactly.`;
    const second = await callWithRetry(client, repairPrompt, jsonSchema, opts);
    try {
      value = await attempt(second);
    } catch (err2) {
      throw new Error(
        `LLM output invalid after repair retry: promptId=${prompt.id}: ${err2 instanceof Error ? err2.message : err2}`,
      );
    }
  }
  await cachePut(db, key, model, prompt.id, value);
  return value;
}

function runValidate<I, O>(prompt: PromptDef<I, O>, input: I, output: O): void {
  const v = (prompt as { validate?: (i: I, o: O) => void }).validate;
  if (v) v(input, output);
}

function toJsonSchema(schema: z.ZodType): object {
  const { $schema: _omit, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}
