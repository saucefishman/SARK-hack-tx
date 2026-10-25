// Muse (Meta Model API) adapter: request bodies, response parsing, errors and retries. No network: fake fetch whose
// responses mirror real Model API shapes (captured 2026-10-25 from muse-spark-1.3-contributor).
import { describe, expect, it } from "vitest";
import { generateGrounded, generateStructured, txnSocial, webCost } from "../src/llm";
import { retryable } from "../src/llm/client";
import {
  MAX_GROUNDED_SOURCES, MuseApiError, chatRequestBody, createMuseClient, createMuseGroundedClient, groundedRequestBody,
  parseChatResponse, parseGroundedResponse,
} from "../src/llm/muse";
import { testDb } from "./helpers";

const BASE = "http://muse.test/v1";
const txnIn = { txnId: "T-1", merchant: "Uchi", category: "restaurant", amountDollars: 80, date: "2026-03-12", siblings: [] };

const chat = (content: string | null, extra: object = {}) => ({
  id: "chatcmpl-1", object: "chat.completion", model: "muse-spark-1.3-contributor",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, refusal: null }, ...extra }],
  usage: { prompt_tokens: 29, completion_tokens: 443, total_tokens: 472, completion_tokens_details: { reasoning_tokens: 393 } },
});
const apiError = (status: number, code: string | null, message: string) =>
  new Response(JSON.stringify({ error: { code, message, param: null, type: "invalid_request_error" } }), { status });

/** fetch fake: one queued response (or thrown error) per call; records url + parsed body + auth header. */
function fakeFetch(queue: (Response | object | Error)[]) {
  const calls: { url: string; body: any; auth: string | null }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
    const next = queue.shift();
    if (next === undefined) throw new Error("fakeFetch: no response queued");
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : new Response(JSON.stringify(next), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const client = (f: typeof fetch) => createMuseClient({ apiKey: "test-key", model: "muse-test", baseUrl: BASE, fetch: f });
const fast = { mode: "live" as const, model: "muse-test", backoffMs: 1 };

// A real Responses answer, trimmed: two "commentary" progress messages, searches with results, one final cited answer.
const grounded = {
  status: "completed", error: null, incomplete_details: null,
  output: [
    { type: "reasoning", id: "rs_1", summary: [], status: "completed" },
    { type: "message", id: "msg_1", role: "assistant", phase: "commentary", status: "completed",
      content: [{ type: "output_text", text: "I'll search the web for current Lady Bird Lake kayak rental prices.", annotations: [] }] },
    { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "Lady Bird Lake kayak rental price" },
      results: [
        { type: "text_result", title: "Austin: Single or Double Kayak Rental", url: "https://theabroadguide.com/kayak/", snippet: "" },
        { type: "text_result", title: "Boat Rentals on Lady Bird Lake", url: "https://capitalcruises.com/rentals/", snippet: "" },
      ] },
    { type: "message", id: "msg_2", role: "assistant", phase: "commentary", status: "completed",
      content: [{ type: "output_text", text: "I'll open the detailed pages to verify the exact pricing.", annotations: [] }] },
    { type: "web_search_call", id: "ws_2", status: "completed", action: { type: "open_page", url: "https://capitalcruises.com/rentals/" }, results: [] },
    { type: "message", id: "msg_3", role: "assistant", status: "completed",
      content: [{ type: "output_text",
        text: "Single kayaks on Lady Bird Lake rent for about $18 to $25 per person per hour. Capital Cruises lists \"Single-person kayak - $18 per hour\".",
        annotations: [
          { type: "url_citation", url: "https://capitalcruises.com/rentals/", title: "Boat Rentals on Lady Bird Lake", start_index: 80, end_index: 130 },
          { type: "url_citation", url: "https://paddle.example/austin/", start_index: 0, end_index: 79 },
        ] }] },
  ],
};

describe("request bodies", () => {
  it("chat: user message, temperature 0, non-strict json_schema (strict forbids our optional fields)", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    expect(chatRequestBody("p", schema, "muse-x", "low")).toEqual({
      model: "muse-x",
      messages: [{ role: "user", content: "p" }],
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { name: "output", schema, strict: false } },
      reasoning_effort: "low",
    });
  });
  it("grounded: Responses API input + web_search tool + raw results included", () => {
    expect(groundedRequestBody("q", "muse-x", "high")).toEqual({
      model: "muse-x", input: "q", temperature: 0, tools: [{ type: "web_search" }], include: ["web_search_call.results"],
      reasoning: { effort: "high" },
    });
  });
  it("posts to <base>/chat/completions with a bearer key", async () => {
    const { f, calls } = fakeFetch([chat("{}")]);
    await createMuseClient({ apiKey: "test-key", model: "muse-test", baseUrl: `${BASE}/`, fetch: f }).generateJson("p", {});
    expect(calls[0]).toMatchObject({ url: `${BASE}/chat/completions`, auth: "Bearer test-key" });
    expect(calls[0]!.body.model).toBe("muse-test");
  });
  it("missing key fails with a clear message (both clients)", () => {
    // config is cached from .env, so an empty key stands in for "not set"
    expect(() => createMuseClient({ apiKey: "" })).toThrow(/META_API_KEY missing.*LLM_MODE=replay/);
    expect(() => createMuseGroundedClient({ apiKey: "" })).toThrow(/META_API_KEY missing/);
  });
});

describe("parseChatResponse", () => {
  it("returns the JSON string from choices[0].message.content", () => {
    expect(parseChatResponse(chat('{"looksSocial": true, "reason": "x"}'))).toBe('{"looksSocial": true, "reason": "x"}');
  });
  it("refusal, truncation (finish_reason=length, content null) and empty output fail loudly", () => {
    expect(() => parseChatResponse({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "can't help" } }] })).toThrow(/refused: can't help/);
    expect(() => parseChatResponse({ choices: [{ finish_reason: "length", message: { content: null, refusal: null } }] })).toThrow(/truncated/);
    expect(() => parseChatResponse({ choices: [{ finish_reason: "stop", message: { content: "" } }] })).toThrow(/no content/);
    expect(() => parseChatResponse({ choices: [] })).toThrow(/no choices/);
  });
});

describe("errors and retries through generateStructured", () => {
  it("success end to end; result validated and cached", async () => {
    const db = await testDb();
    const { f, calls } = fakeFetch([chat('{"looksSocial": true, "reason": "Friday dinner"}')]);
    const o = { ...fast, client: client(f) };
    expect(await generateStructured(db, txnSocial, txnIn, o)).toEqual({ looksSocial: true, reason: "Friday dinner" });
    await generateStructured(db, txnSocial, txnIn, o);
    expect(calls).toHaveLength(1);
  });
  it("HTTP errors become MuseApiError with status + code", async () => {
    const { f } = fakeFetch([apiError(401, "invalid_api_key", "Unauthorized")]);
    const e = await client(f).generateJson("p", {}).catch((x) => x);
    expect(e).toBeInstanceOf(MuseApiError);
    expect(e).toMatchObject({ status: 401, code: "invalid_api_key" });
    expect(e.message).toMatch(/401 invalid_api_key: Unauthorized/);
    const { f: f2 } = fakeFetch([new Response("<html>bad gateway</html>", { status: 502 })]);
    expect(await client(f2).generateJson("p", {}).catch((x) => x)).toMatchObject({ status: 502, code: null });
  });
  it("429 and 5xx retry then succeed; 4xx (bad key, unknown model) fail at once", async () => {
    const db = await testDb();
    const r = fakeFetch([apiError(429, "rate_limit_exceeded", "slow down"), apiError(503, null, "overloaded"), chat('{"looksSocial":false,"reason":"r"}')]);
    await generateStructured(db, txnSocial, txnIn, { ...fast, client: client(r.f) });
    expect(r.calls).toHaveLength(3);
    const bad = fakeFetch([apiError(404, "model_not_found", "The requested model was not found.")]);
    await expect(generateStructured(db, txnSocial, { ...txnIn, txnId: "T-2" }, { ...fast, client: client(bad.f) })).rejects.toThrow(/model_not_found/);
    expect(bad.calls).toHaveLength(1);
  });
  it("dropped connections retry; daily quotas and refusals do not", async () => {
    const db = await testDb();
    const net = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    const r = fakeFetch([net, chat('{"looksSocial":false,"reason":"r"}')]);
    await generateStructured(db, txnSocial, { ...txnIn, txnId: "T-3" }, { ...fast, client: client(r.f) });
    expect(r.calls).toHaveLength(2);
    expect(retryable(new MuseApiError(429, "rate_limit_exceeded", "daily request limit reached"))).toBe(false);
    expect(retryable(new Error("Muse refused: no"))).toBe(false);
  });
  it("invalid JSON from the model goes through the repair retry (one extra call)", async () => {
    const db = await testDb();
    const r = fakeFetch([chat('{"looksSocial":"maybe"}'), chat('{"looksSocial":true,"reason":"fixed"}')]);
    expect(await generateStructured(db, txnSocial, { ...txnIn, txnId: "T-4" }, { ...fast, client: client(r.f) })).toMatchObject({ reason: "fixed" });
    expect(r.calls[1]!.body.messages[0].content).toContain("Your previous response was invalid");
  });
});

describe("parseGroundedResponse", () => {
  it("keeps only the final (non-commentary) answer text", () => {
    const g = parseGroundedResponse(grounded);
    expect(g.text).toMatch(/^Single kayaks on Lady Bird Lake/);
    expect(g.text).not.toContain("I'll search");
    expect(g.text).not.toContain("open the detailed pages");
  });
  it("sources: citations first (API records, not model text), then search results, deduped; title optional", () => {
    expect(parseGroundedResponse(grounded).sources).toEqual([
      { uri: "https://capitalcruises.com/rentals/", title: "Boat Rentals on Lady Bird Lake" },
      { uri: "https://paddle.example/austin/" },
      { uri: "https://theabroadguide.com/kayak/", title: "Austin: Single or Double Kayak Rental" },
    ]);
  });
  it(`caps at ${MAX_GROUNDED_SOURCES} sources but never drops a citation`, () => {
    const results = Array.from({ length: 30 }, (_, i) => ({ url: `https://r.example/${i}`, title: `r${i}` }));
    const cites = Array.from({ length: 12 }, (_, i) => ({ type: "url_citation", url: `https://c.example/${i}` }));
    const res = (c: { type: string; url: string }[]) => ({
      status: "completed",
      output: [
        { type: "web_search_call", results },
        { type: "message", content: [{ type: "output_text", text: "t", annotations: c }] },
      ],
    });
    expect(parseGroundedResponse(res(cites.slice(0, 2))).sources).toHaveLength(MAX_GROUNDED_SOURCES);
    expect(parseGroundedResponse(res(cites)).sources.map((s) => s.uri)).toEqual(cites.map((c) => c.url));
  });
  it("no searches -> empty sources (generateGrounded then returns null); failed / incomplete responses throw", () => {
    const plain = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "about $30", annotations: [] }] }] };
    expect(parseGroundedResponse(plain)).toEqual({ text: "about $30", sources: [] });
    expect(() => parseGroundedResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })).toThrow(/incomplete: max_output_tokens/);
    expect(() => parseGroundedResponse({ status: "failed", error: { message: "boom" } })).toThrow(/failed: boom/);
  });
});

describe("webCost end to end over the Muse adapter", () => {
  it("grounded call -> extraction sees the numbered sources -> URL comes from a citation", async () => {
    const db = await testDb();
    const g = fakeFetch([grounded]);
    const x = fakeFetch([chat('{"perPersonDollars": 18, "sourceIndex": 0, "confidence": 0.8}')]);
    const opts = {
      ...fast,
      grounded: createMuseGroundedClient({ apiKey: "k", model: "muse-test", baseUrl: BASE, fetch: g.f }),
      client: client(x.f),
    };
    const out = await generateGrounded(db, webCost, { venue: "Kayaking at Lady Bird Lake", eventType: "kayak rental" }, opts);
    expect(out).toEqual({ perPersonDollars: 18, sourceUrl: "https://capitalcruises.com/rentals/", sourceTitle: "Boat Rentals on Lady Bird Lake", confidence: 0.8 });
    expect(g.calls[0]!.url).toBe(`${BASE}/responses`);
    const extractPrompt: string = x.calls[0]!.body.messages[0].content;
    expect(extractPrompt).toContain("0: Boat Rentals on Lady Bird Lake https://capitalcruises.com/rentals/");
    expect(extractPrompt).toContain("1: (untitled) https://paddle.example/austin/");
    expect(extractPrompt).not.toContain("I'll search");
    // cached by venue + event type: a second lookup makes no calls
    await generateGrounded(db, webCost, { venue: "kayaking at lady bird lake ", eventType: "Kayak Rental" }, opts);
    expect([g.calls.length, x.calls.length]).toEqual([1, 1]);
  });
});
