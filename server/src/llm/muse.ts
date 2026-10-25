// The ONE generation provider adapter: Meta Model API (Muse), plain HTTP (OpenAI-compatible wire format).
//  - createMuseClient():         Chat Completions + JSON-schema structured output -> LlmClient (used by generateStructured)
//  - createMuseGroundedClient(): Responses API + `web_search` tool -> GroundedClient (used by generateGrounded)
// Everything provider-specific (request bodies, response parsing, error shapes) lives here; client.ts and webSearch.ts
// only see LlmClient / GroundedClient. Embeddings are not here: the Model API has no embedding model (see embed.ts).
import { getConfig } from "../config";
import { runTraced } from "../obs/tracing";
import type { LlmClient } from "./client";
import type { GroundedClient, GroundedResult, GroundedSource } from "./webSearch";

/** LLM_REASONING values ("default" = omit the parameter; the model picks its own level). */
export type ReasoningLevel = "default" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Grounding sources passed on to extraction: every cited URL first, then search results up to this cap. */
export const MAX_GROUNDED_SOURCES = 10;

export interface MuseClientOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  reasoning?: ReasoningLevel;
  /** Tests inject a fake; default global fetch. */
  fetch?: typeof fetch;
}

/** A non-2xx Model API answer. `status` drives retryable() (429/5xx retry); `code` is the API's error code. */
export class MuseApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "MuseApiError";
  }
}

/** Reasoning params in the shape each API wants. Not part of the cache key (same rule as before). */
export function reasoningParams(api: "chat" | "responses", level: ReasoningLevel = getConfig().LLM_REASONING) {
  if (level === "default") return {};
  return api === "chat" ? { reasoning_effort: level } : { reasoning: { effort: level } };
}

/** Chat Completions body for one structured-JSON call. strict:false because strict mode forbids optional fields
 *  (every key must be `required`); output is schema-constrained either way, and zod validates it afterwards. */
export function chatRequestBody(prompt: string, jsonSchema: object, model: string, level?: ReasoningLevel) {
  return {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    response_format: { type: "json_schema", json_schema: { name: "output", schema: jsonSchema, strict: false } },
    ...reasoningParams("chat", level),
  };
}

/** Responses API body for one web-search-grounded free-text call (search grounding is not on Chat Completions). */
export function groundedRequestBody(prompt: string, model: string, level?: ReasoningLevel) {
  return {
    model,
    input: prompt,
    temperature: 0,
    tools: [{ type: "web_search" }],
    include: ["web_search_call.results"],
    ...reasoningParams("responses", level),
  };
}

interface ChatResponse {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
}

/** The JSON text of a chat completion. Refusals and truncated/empty output fail loudly (never parsed as data). */
export function parseChatResponse(res: ChatResponse): string {
  const choice = res.choices?.[0];
  if (!choice?.message) throw new Error("Muse chat completion has no choices");
  if (choice.message.refusal) throw new Error(`Muse refused: ${choice.message.refusal}`);
  if (choice.finish_reason === "length") {
    throw new Error("Muse output truncated (finish_reason=length): reasoning + output exceeded the token limit");
  }
  const text = choice.message.content;
  if (text == null || text === "") throw new Error(`Muse returned no content (finish_reason=${choice.finish_reason ?? "?"})`);
  return text;
}

interface ResponsesOutputItem {
  type: string;
  phase?: string;
  content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[];
  action?: { type?: string; url?: string };
  results?: { url?: string; title?: string }[];
}
interface ResponsesResponse {
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: ResponsesOutputItem[];
}

/**
 * Final answer text + source URLs from a Responses API web-search answer. Muse interleaves "commentary" messages
 * ("I'll search the web...") between searches; only the non-commentary message(s) are the answer. Sources come from the
 * API's own records, never the model's text: `url_citation` annotations first (they support the answer), then
 * `web_search_call` results, deduped by URL and capped at MAX_GROUNDED_SOURCES (citations are never dropped).
 */
export function parseGroundedResponse(res: ResponsesResponse): GroundedResult {
  if (res.status && res.status !== "completed") {
    const why = res.error?.message ?? res.incomplete_details?.reason ?? "unknown";
    throw new Error(`Muse web search response ${res.status}: ${why}`);
  }
  const items = res.output ?? [];
  const answer = items.filter((o) => o.type === "message" && o.phase !== "commentary");
  const parts = answer.flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text");
  const text = parts.map((c) => c.text ?? "").join("\n").trim();

  const seen = new Set<string>();
  const cited: GroundedSource[] = [];
  const found: GroundedSource[] = [];
  const add = (into: GroundedSource[], uri: string | undefined, title: string | undefined) => {
    if (!uri || seen.has(uri)) return;
    seen.add(uri);
    into.push({ uri, ...(title ? { title } : {}) });
  };
  for (const c of parts) for (const a of c.annotations ?? []) if (a.type === "url_citation") add(cited, a.url, a.title);
  for (const o of items) {
    if (o.type !== "web_search_call") continue;
    for (const r of o.results ?? []) add(found, r.url, r.title);
  }
  return { text, sources: [...cited, ...found.slice(0, Math.max(0, MAX_GROUNDED_SOURCES - cited.length))] };
}

async function post<T>(f: typeof fetch, baseUrl: string, key: string, path: string, body: object): Promise<T> {
  const res = await f(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    let code: string | null = null;
    let msg = raw.slice(0, 500);
    try {
      const e = (JSON.parse(raw) as { error?: { code?: string | null; message?: string } }).error;
      code = e?.code ?? null;
      msg = e?.message ?? msg;
    } catch {
      // non-JSON error body: keep the raw text
    }
    throw new MuseApiError(res.status, code, `Muse API ${path} failed: ${res.status}${code ? ` ${code}` : ""}: ${msg}`);
  }
  return JSON.parse(raw) as T;
}

function resolve(o: MuseClientOptions) {
  const cfg = getConfig();
  const key = o.apiKey ?? cfg.META_API_KEY;
  if (!key) throw new Error("META_API_KEY missing (Meta Model API key); use LLM_MODE=replay");
  return { key, model: o.model ?? cfg.LLM_MODEL, baseUrl: o.baseUrl ?? cfg.META_BASE_URL, level: o.reasoning, f: o.fetch ?? fetch };
}

export function createMuseClient(o: MuseClientOptions = {}): LlmClient {
  const { key, model, baseUrl, level, f } = resolve(o);
  return {
    generateJson(prompt, jsonSchema) {
      return runTraced("muse:chat", { model, prompt }, async () => {
        const res = await post<ChatResponse & { usage?: unknown }>(f, baseUrl, key, "/chat/completions", chatRequestBody(prompt, jsonSchema, model, level));
        return { text: parseChatResponse(res), usage: res.usage };
      }, { runType: "llm", metadata: { model }, processOutputs: (r) => ({ output: r.text, usage: r.usage }) }).then((r) => r.text);
    },
  };
}

export function createMuseGroundedClient(o: MuseClientOptions = {}): GroundedClient {
  const { key, model, baseUrl, level, f } = resolve(o);
  return {
    search(prompt) {
      return runTraced("muse:web_search", { model, prompt }, async () => {
        const res = await post<ResponsesResponse>(f, baseUrl, key, "/responses", groundedRequestBody(prompt, model, level));
        return parseGroundedResponse(res);
      }, { runType: "llm", metadata: { model }, processOutputs: (r: GroundedResult) => ({ output: r.text, sources: r.sources }) });
    },
  };
}
