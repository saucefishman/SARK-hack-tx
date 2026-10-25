# Migration: Gemini → Muse Spark 1.3 (contributor)

Date: 2026-10-25 · Branch: `meta-migration`

All LLM generation (structured extraction and web-search-grounded price lookups) now runs on Meta's Model API with `muse-spark-1.3-contributor`. Gemini remains only for embeddings, because Meta's Model API has no embedding model. Embeddings default to the offline local embedder, so the demo, eval and tests never contact Google.

## Summary

| Area | Before | After |
|---|---|---|
| Structured output | Gemini SDK `generateContent`, `responseJsonSchema` | Muse Chat Completions `POST /v1/chat/completions`, `response_format: json_schema` (`strict: false`) |
| Web search (cold-start cost) | Gemini + `googleSearch` tool, URLs from `groundingMetadata.groundingChunks` | Muse Responses API `POST /v1/responses`, `tools: [{type: "web_search"}]`, URLs from `url_citation` annotations + `web_search_call.results` |
| Reasoning | `GEMINI_THINKING` (default/low/high) → `thinkingConfig.thinkingLevel` | `LLM_REASONING` (default/minimal/low/medium/high/xhigh) → `reasoning_effort` (chat) / `reasoning.effort` (responses) |
| Embeddings | Gemini `gemini-embedding-001` (live) / local (default) | **Unchanged** |
| Client code | `@google/genai` SDK | Plain `fetch` (no new dependency); `@google/genai` stays for embeddings only |
| Tracing | `langsmith/wrappers/gemini` wrapping the SDK | Traced HTTP calls: `muse:chat` / `muse:web_search` `llm` runs with token usage |

## Configuration and env vars (shared contract, please tell the team)

Added in `server/src/config.ts` and `.env.example`:

| Var | Default | Notes |
|---|---|---|
| `META_API_KEY` | none | Required for `LLM_MODE=live` (it replaces `GEMINI_API_KEY` in that check). |
| `META_BASE_URL` | `https://api.meta.ai/v1` | |
| `LLM_MODEL` | `muse-spark-1.3-contributor` | Replaces `GEMINI_MODEL`. Set `muse-spark-1.3` for the standard model (contributor mode: Meta trains on prompts and completions). |
| `LLM_REASONING` | `low` | Replaces `GEMINI_THINKING`. `none` (HTTP 400 on Muse Spark) and `max` (not on contributor models) are deliberately not allowed. |

Removed: `GEMINI_MODEL`, `GEMINI_THINKING`. If an old `.env` still has them, they are ignored, not treated as errors. **Each teammate must update their own `.env`.**

Kept: `GEMINI_API_KEY` and `GEMINI_EMBED_MODEL`, now for embeddings only (`EMBED_MODE=live`).

`.env` (git-ignored, local only): added `META_API_KEY` (your key), `META_BASE_URL` and `LLM_MODEL`; replaced `GEMINI_THINKING=low` with `LLM_REASONING=low`; removed `GEMINI_MODEL`. A backup of the previous `.env` is in the session scratchpad.

## Code changes

### New: `server/src/llm/muse.ts`

The only file that knows the Meta API wire format.
- `createMuseClient()` → `LlmClient` (Chat Completions + JSON schema).
- `createMuseGroundedClient()` → `GroundedClient` (Responses API + `web_search`).
- `chatRequestBody`, `groundedRequestBody`, `reasoningParams`: request construction, `temperature: 0` as before.
- `parseChatResponse`: the JSON comes as a string in `choices[0].message.content`.
  - A **refusal** (`message.refusal`) fails loudly.
  - **Truncation** fails with a clear error. Muse answers HTTP 200 with `finish_reason: "length"` and `content: null` when reasoning plus output exceed the token limit.
  - Empty content fails too.
- `parseGroundedResponse`:
  - Muse interleaves **`phase: "commentary"` progress messages** ("I'll search the web…") between searches. Only the non-commentary message counts as the answer; otherwise the narration would reach the price extractor.
  - Sources come from the API's own records, never the model's text: `url_citation` annotations first, then `web_search_call.results`. They are deduped and capped at `MAX_GROUNDED_SOURCES = 10`; citations are never dropped.
  - A response with status `incomplete` or `failed` throws.
- `MuseApiError` (`status`, `code`): parsed from Meta's `{error: {code, message, type}}` body. The status drives retries: 429/5xx retry, 401/400/404 fail at once.

Why `strict: false`: Meta's strict mode requires every property to be listed in `required`. Our zod schemas use optional fields, so strict mode returns HTTP 400 (confirmed live). Output is still schema-constrained, and zod validates it as before.

### Renamed: `server/src/llm/gemini.ts` → `server/src/llm/client.ts`

The cache, fixture replay, retry, repair-retry and validation logic has nothing to do with Gemini, so it is kept as is and renamed.
- Removed `createGeminiClient`, `thinkingConfig`, `generationConfig` and the `@google/genai` import.
- The default live client is now `createMuseClient({ model })`, and the model comes from `LLM_MODEL`.
- `retryable()` now also retries dropped connections (`fetch failed`, `ECONNRESET`, etc.), because raw `fetch` has no SDK-level retry. It treats a "daily" quota message as fatal and recognises `rate_limit` errors.

### Other source files

- `server/src/llm/webSearch.ts`: removed the Gemini `createGroundedClient` and `groundedConfig`; the default grounded client is `createMuseGroundedClient`. The two-call design (grounded free text, then structured extraction) and the cached value shape are unchanged, so the existing `webCost` replay fixtures still apply.
- `server/src/llm/index.ts`: exports `createMuseClient`, `createMuseGroundedClient`, `MuseApiError` and their types instead of `createGeminiClient` and `createGroundedClient`.
- `server/src/llm/embed.ts`: imports `retryable` from `./client`; the comment notes this is the last Gemini use.
- `server/src/obs/tracing.ts`: removed `wrapGenAI` and the `langsmith/wrappers/gemini` import.
- `server/src/config.ts`: the new env vars described above.
- `server/src/pipeline/run.ts`: trace metadata uses `LLM_MODEL`.
- `server/src/cli/llm-smoke.ts`: needs `META_API_KEY`, prints the model and reasoning level, and now also runs a `webCost` web-search lookup.
- `server/src/cli/eval.ts`: comment update, plus an **incidental fix**. A live eval with mismatches used to print "report only" and then also "eval OK: every friend total equals truth exactly".
- Comment-only updates: `domain/estimateBaseCost.ts`, `llm/types.ts`, `llm/prompts/webCost.ts`, `pipeline/cost.ts`.

### Behaviour fixes for Muse output (found by the live eval)

**RAG price extraction (`costFromSnippets`).** At `low` reasoning, Muse sometimes broke the "never do arithmetic" rule that Gemini followed. Given "Ego's was like $20 a head", it either filed `$20` as `totalDollars` or reported `totalDollars: 60` ($20 × 3 people), so the RAG step returned nothing.
- `server/src/domain/ragCost.ts`: `quotesStatedInText()` keeps a reported figure only if that exact dollar amount appears in the retrieved message's real text. Computed or borrowed numbers are dropped, so the code fails safe and never invents an amount. A figure filed as `totalDollars` with no headcount, which the text writes as per-person ("$20 a head", "$25 each"), is moved to `perPersonDollars`. Helpers: `dollarAmountsIn`, `statedPerPerson`.
- `server/src/pipeline/cost.ts`: `ragHistoryCost` applies the guard before taking the median.
- `server/src/llm/prompts/costFromSnippets.ts`: prompt **v2** adds field examples and the rule that every number must appear in that snippet. The version bump changes the cache key; replay fixtures are looked up by readable key, so they still apply.
- Measured live on the real karaoke input: prompt v1 at low reasoning was correct in 2 of 3 runs, v2 in 5 of 6, and v2 plus the guard recovers the remaining field mix-up.

## Tests

- New `server/test/muse.test.ts` (16 tests): request bodies, auth, missing key, response parsing (refusal, truncation, empty, no choices), HTTP errors → `MuseApiError`, retry rules (429/5xx/network retry; 4xx, daily quota and refusals don't), the repair retry over the adapter, commentary filtering, citation ordering, dedup and the cap, incomplete and failed responses, and `webCost` end to end. The fake responses copy real Muse responses captured live.
- `server/test/speed.test.ts`: the `GEMINI_THINKING` tests are replaced by `LLM_REASONING` tests (config default, mapping to both APIs, `none`/`max` rejected, omitted for `default`).
- `server/test/tracing.test.ts`: the `wrapGenAI` passthrough check is replaced by a test that a Muse call becomes a `muse:chat` `llm` run with token usage and an unchanged result.
- `server/test/cost.test.ts`: 5 new tests for the guard, including both live Muse failures reproduced exactly.

## Verification

| Check | Before | After |
|---|---|---|
| `pnpm -r typecheck` | pass | pass |
| `pnpm --filter server test` | 117/117 | **139/139** |
| `pnpm --filter server eval` (replay) | 22/22 events, every friend total exact | **identical**: 22/22, every friend total exact |
| Live smoke (`llm-smoke.ts`) | not run | pass: `messageDay` extraction correct; web search returned a cited Rowing Dock URL at $20/person |
| Live eval (`eval --llm live`, full pipeline on Muse) | not run | 22/22 events matched, 22/22 attendees, 19/22 payers (final run) |

How to read the live misses (the live eval only reports):
- **Kayak ($40 vs $50) is expected, not a bug.** The truth file uses a hand-written $25/person web fixture, while live web search found the real Lady Bird Lake price of about $20/person.
- **Coffee and brunch (amount stated but returned as unknown) are intermittent model omissions.** In controlled live reruns of the exact pipeline input, Muse dropped a stated amount in about 2 of 10 runs at `low` and 1 of 10 at `medium`. Earlier full runs got both right. Raising the default reasoning level wasn't worth the extra tokens, so `low` stays.
- An unknown amount is never guessed: it shows up as an `unaccounted` row, exactly as before the migration.

## Not changed

- Embeddings (`EMBED_MODE`, `geminiEmbedder`, the 768-dim `vector(768)` column), so no re-embedding or migration is needed.
- DB schema and migrations. The `001_init.sql` comment still says "Gemini record/replay cache"; applied migrations aren't edited.
- Shared API types and routes (`packages/shared`), the app, prompts other than `costFromSnippets`, replay fixtures, seed data, `truth.json`.
- `DESIGN.md` and `BUILDPLAN.md` still name Gemini in places (stack table, model ids, H3). They weren't edited, per instruction; they are the remaining stale references.

## Follow-ups

- Live LLM caches: `llm_cache` keys include the model name, so Gemini-era cached answers are never served as Muse answers. A live run fills the cache again (about 70 calls for the seed scenario, about 3.5 minutes).
- The `muse-spark-1.3-contributor` model gives Meta prompt and completion data for training. That's fine for the synthetic seed data; switch `LLM_MODEL=muse-spark-1.3` before running on real messages.
