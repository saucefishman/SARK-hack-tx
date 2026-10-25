// The ONE embedder. Two implementations behind `Embedder`:
//  - geminiEmbedder(): live Gemini embeddings (768 dims, L2-normalized, batched, retrying). The only Gemini use left:
//    generation moved to Muse (llm/muse.ts), but Meta's Model API has no embedding model.
//  - localEmbedder():  deterministic offline feature-hashing STAND-IN for replay/tests (not semantic).
// embedTexts() adds a per-text cache in `embedding_cache`.
import { GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";
import { getConfig } from "../config";
import type { Db } from "../db/pool";
import { runTraced } from "../obs/tracing";
import { retryable } from "./client";

export const EMBED_DIMS = 768;
const BATCH = 100;

export interface Embedder {
  model: string;
  dims: number;
  /** One vector per text, same order, L2-normalized. */
  embed(texts: string[]): Promise<number[][]>;
}

export function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return n === 0 ? v.map(() => 0) : v.map((x) => x / n);
}

// --- local stand-in -------------------------------------------------------------------------

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hashInto(vec: number[], feature: string, weight: number): void {
  const h = fnv1a(feature);
  vec[h % vec.length]! += (fnv1a(`~${feature}`) & 1 ? 1 : -1) * weight;
}

/**
 * Deterministic, offline, NOT semantic: feature hashing of lowercase word unigrams, bigrams and char
 * trigrams into 768 dims. Texts sharing words score high. A stand-in for replay/tests; use live for real similarity.
 */
export function localEmbedder(): Embedder {
  return {
    model: "local-hash-v1",
    dims: EMBED_DIMS,
    async embed(texts) {
      return texts.map((text) => {
        const vec = new Array<number>(EMBED_DIMS).fill(0);
        const words = text.toLowerCase().match(/[a-z0-9$']+/g) ?? [];
        words.forEach((w, i) => {
          hashInto(vec, `u:${w}`, 1);
          if (i > 0) hashInto(vec, `b:${words[i - 1]}_${w}`, 0.7);
          const padded = `^${w}$`;
          for (let j = 0; j + 3 <= padded.length; j++) hashInto(vec, `c:${padded.slice(j, j + 3)}`, 0.25);
        });
        return l2normalize(vec);
      });
    },
  };
}

// --- live Gemini ----------------------------------------------------------------------------

/** The slice of `ai.models` we use (so tests can inject a fake). */
export interface EmbedClient {
  embedContent(params: {
    model: string;
    contents: string[];
    config?: { outputDimensionality?: number; taskType?: string };
  }): Promise<{ embeddings?: { values?: number[] }[] }>;
}

export interface GeminiEmbedderOptions {
  client?: EmbedClient;
  model?: string;
  maxTries?: number;
  backoffMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function geminiEmbedder(o: GeminiEmbedderOptions = {}): Embedder {
  const cfg = getConfig();
  const model = o.model ?? cfg.GEMINI_EMBED_MODEL;
  let client = o.client;
  if (!client) {
    if (!cfg.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing (human task H3); use EMBED_MODE=local");
    client = new GoogleGenAI({ apiKey: cfg.GEMINI_API_KEY }).models as unknown as EmbedClient;
  }
  const c = client;
  const max = o.maxTries ?? 4;
  const base = o.backoffMs ?? 1000;
  const callBatch = async (batch: string[]): Promise<number[][]> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await c.embedContent({ model, contents: batch, config: { outputDimensionality: EMBED_DIMS } });
        const vecs = (res.embeddings ?? []).map((e) => e.values ?? []);
        if (vecs.length !== batch.length || vecs.some((v) => v.length !== EMBED_DIMS)) {
          throw new Error(`embedContent returned ${vecs.length} vectors (dims ${vecs[0]?.length}), expected ${batch.length}x${EMBED_DIMS}`);
        }
        return vecs.map(l2normalize);
      } catch (e) {
        if (attempt >= max || !retryable(e)) throw e;
        await sleep(base * 2 ** (attempt - 1));
      }
    }
  };
  return {
    model,
    dims: EMBED_DIMS,
    embed(texts) {
      return runTraced("embed:gemini", { count: texts.length, model }, async () => {
        const out: number[][] = [];
        for (let i = 0; i < texts.length; i += BATCH) out.push(...(await callBatch(texts.slice(i, i + BATCH))));
        return out;
      }, { runType: "embedding", processOutputs: (v: number[][]) => ({ count: v.length, dims: v[0]?.length ?? 0 }) });
    },
  };
}

/** EMBED_MODE: local (default, offline) or live (needs GEMINI_API_KEY). */
export function getEmbedder(mode: "local" | "live" = getConfig().EMBED_MODE): Embedder {
  return mode === "live" ? geminiEmbedder() : localEmbedder();
}

// --- cache ----------------------------------------------------------------------------------

export const embeddingKey = (e: Pick<Embedder, "model" | "dims">, text: string) =>
  createHash("sha256").update(`${e.model}\n${e.dims}\n${text}`).digest("hex");

/** Embeds with a per-text cache in `embedding_cache`; only misses reach the embedder. */
export async function embedTexts(db: Db, texts: string[], embedder: Embedder = getEmbedder()): Promise<number[][]> {
  const keys = texts.map((t) => embeddingKey(embedder, t));
  const found = new Map<string, number[]>();
  if (keys.length) {
    const { rows } = await db.query<{ key: string; embedding: number[] }>(
      "SELECT key, embedding FROM embedding_cache WHERE key = ANY($1::text[])",
      [[...new Set(keys)]],
    );
    for (const r of rows) found.set(r.key, r.embedding.map((x) => Math.fround(Number(x))));
  }
  const missIdx = [...new Set(keys.filter((k) => !found.has(k)))].map((k) => keys.indexOf(k));
  if (missIdx.length) {
    // float4 precision, so fresh and cached results are identical
    const vecs = (await embedder.embed(missIdx.map((i) => texts[i]!))).map((v) => v.map(Math.fround));
    for (let j = 0; j < missIdx.length; j++) {
      const i = missIdx[j]!;
      found.set(keys[i]!, vecs[j]!);
      await db.query(
        `INSERT INTO embedding_cache (key, model, dims, embedding) VALUES ($1, $2, $3, $4::real[])
         ON CONFLICT (key) DO NOTHING`,
        [keys[i], embedder.model, embedder.dims, pgArray(vecs[j]!)],
      );
    }
  }
  return keys.map((k) => found.get(k)!);
}

/** Postgres array literal for a real[] param (works for both pg and PGlite). */
export const pgArray = (v: number[]) => `{${v.join(",")}}`;
/** pgvector literal. */
export const pgVector = (v: number[]) => `[${v.join(",")}]`;
