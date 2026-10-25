// Web-search-grounded LLM lookups, behind the same cache -> fixture (replay) -> live machinery as generateStructured.
// Search grounding is only on Muse's Responses API and is not combined with JSON-schema output here, so live mode makes
// TWO calls: (1) a grounded free-text call that also returns the source URLs, (2) a structured extraction over that text
// (via LlmClient.generateJson). The final value (what is cached and what replay fixtures contain) holds a URL taken from
// the API's citation/search-result records, never from the model's text. Provider wire format: llm/muse.ts.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { getConfig } from "../config";
import type { Db } from "../db/pool";
import {
  DEFAULT_FIXTURES_DIR, traceLlmCall, type LlmSource, cacheGet, cacheKey, cachePut, callWithRetry, extractJson, previewInput,
  retryable, stripNulls, toJsonSchema, type GenerateOptions,
} from "./client";
import { createMuseClient, createMuseGroundedClient } from "./muse";

export interface GroundedSource { uri: string; title?: string }
export interface GroundedResult { text: string; sources: GroundedSource[] }

export interface GroundedClient {
  /** One web-search-grounded free-text call. Throw errors carrying `.status` for HTTP failures. */
  search(prompt: string): Promise<GroundedResult>;
}

export interface WebSearchPromptDef<I, O, E> {
  id: string;
  version: string;
  /** Final value schema (cached; fixture files hold this shape). */
  schema: z.ZodType<O>;
  /** Schema of the extraction call's JSON. */
  extractSchema: z.ZodType<E>;
  /** What identifies the cache entry (e.g. venue + event type, no dates). */
  cacheInput(input: I): unknown;
  fixtureKey(input: I): string;
  renderSearch(input: I): string;
  renderExtract(input: I, grounded: GroundedResult): string;
  /** Map the extraction + grounded sources to the final value; null = nothing usable (not cached). */
  finalize(extract: E, grounded: GroundedResult): O | null;
}

export interface WebSearchOptions extends GenerateOptions {
  /** Grounded client for live mode (tests inject a fake). */
  grounded?: GroundedClient;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function searchWithRetry(client: GroundedClient, prompt: string, o: GenerateOptions): Promise<GroundedResult> {
  const max = o.maxTries ?? 4;
  const base = o.backoffMs ?? 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.search(prompt);
    } catch (e) {
      if (attempt >= max || !retryable(e)) throw e;
      await sleep(base * 2 ** (attempt - 1));
    }
  }
}

/** Cached / replayed / live grounded lookup. Returns null when the web gave nothing usable. */
export async function generateGrounded<I, O, E>(
  db: Db,
  prompt: WebSearchPromptDef<I, O, E>,
  input: I,
  opts: WebSearchOptions = {},
): Promise<O | null> {
  const model = opts.model ?? getConfig().LLM_MODEL;
  return traceLlmCall<O | null>(prompt, input, model, () => generateGroundedInner(db, prompt, input, opts));
}

async function generateGroundedInner<I, O, E>(
  db: Db,
  prompt: WebSearchPromptDef<I, O, E>,
  input: I,
  opts: WebSearchOptions,
): Promise<{ value: O | null; source: LlmSource }> {
  const cfg = getConfig();
  const mode = opts.mode ?? cfg.LLM_MODE;
  const model = opts.model ?? cfg.LLM_MODEL;
  const key = cacheKey(prompt.id, prompt.version, model, prompt.cacheInput(input));

  const hit = await cacheGet(db, key, prompt.schema);
  if (hit !== undefined) return { value: hit, source: "cache" };

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
    await cachePut(db, key, model, prompt.id, value);
    return { value, source: "fixture" };
  }

  const grounded = await searchWithRetry(opts.grounded ?? createMuseGroundedClient({ model }), prompt.renderSearch(input), opts);
  if (!grounded.sources.length) return { value: null, source: "live" }; // no URL to cite -> nothing usable

  const client = opts.client ?? createMuseClient({ model });
  const jsonSchema = toJsonSchema(prompt.extractSchema);
  const base = prompt.renderExtract(input, grounded);
  const parse = (text: string) => prompt.extractSchema.parse(stripNulls(extractJson(text)));
  const first = await callWithRetry(client, base, jsonSchema, opts);
  let extract: E;
  try {
    extract = parse(first);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const second = await callWithRetry(
      client,
      `${base}\n\nYour previous response was invalid.\nPrevious response:\n${first}\n\nError:\n${msg}\n\nReturn corrected JSON only, matching the schema exactly.`,
      jsonSchema,
      opts,
    );
    try {
      extract = parse(second);
    } catch (err2) {
      throw new Error(`LLM output invalid after repair retry: promptId=${prompt.id}: ${err2 instanceof Error ? err2.message : err2}`);
    }
  }
  const out = prompt.finalize(extract, grounded);
  if (out === null) return { value: null, source: "live" };
  const value = prompt.schema.parse(out);
  await cachePut(db, key, model, prompt.id, value);
  return { value, source: "live" };
}
