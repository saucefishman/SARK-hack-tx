# Code Structure

Index of classes and functions others may reuse. Check before writing new code; update in the same commit when you add, rename, move, or delete something listed here.

Format: `path` — `Name` — one-line purpose

<!-- entries below -->

## Contracts (frozen in Phase 0 — coordinate before changing)
- `packages/shared/src/domain.ts` — `USER_ID`, `Basis`, `LedgerKind`, `Person`, `Event`, `EventPayer`, `LedgerEntry`, `ReviewItem`, ... — zod schemas + types mirroring the DB
- `packages/shared/src/api.ts` — `FriendSummary`, `FriendDetailResponse`, `ReviewItemDto`, `ReviewAnswerBody`, `HealthResponse` — API DTOs (cents on the wire)
- `server/migrations/001_init.sql` — all tables from DESIGN.md §5 plus `llm_cache`
- `server/src/sources/types.ts` — `MessageSource`, `CalendarSource`, `NessieSource`, `RawMessage`, Nessie shapes — source adapter interfaces
- `server/src/llm/types.ts` — `PromptDef<I,O>` — prompt contract (id, version, schema, render, fixtureKey)

## Server infrastructure
- `server/src/config.ts` — `getConfig()`, `REPO_ROOT` — the one env loader (zod, fail fast); incl. `META_API_KEY`, `LLM_MODEL`, `LLM_REASONING`, `LLM_CONCURRENCY`, `EMBED_MODE`, `LANGSMITH_*`
- `server/src/util/mapLimit.ts` — `mapLimit(items, limit, fn)` — order-preserving bounded-concurrency map (parallel LLM calls)
- `server/src/db/pool.ts` — `Db`, `createDb(url)`, `getDb()` — the one DB handle; `postgres://` → pg, `pglite://dir|memory` → embedded PGlite
- `server/src/db/migrate.ts` — `migrate(db)` — applies `migrations/*.sql` in order
- `server/test/helpers.ts` — `testDb()` — fresh in-memory migrated DB for tests

## Domain (pure)
- `server/src/domain/balance.ts` — `friendTotals(friendId, entries)` — spent on you / you spent / balance / possible per friend
- `server/src/domain/money.ts` — `dollarsToCents(n)`, `formatCents(c)` — dollar→cent boundary conversion; log formatting
- `server/src/domain/ids.ts` — `stableId(prefix, ...parts)`, `eventId({date, attendeeIds, anchor})` — deterministic ids (sha256)
- `server/src/domain/relevance.ts` — `isRelevant(...)`, `needsAttendeeReview(...)` — binary relevance rule (DESIGN §4)
- `server/src/domain/split.ts` — `splitEvent({attendeeIds, payers, onlyTouching?})`, `allocate(total, weights)` — 6d equal split + multi-payer netting, largest-remainder cents
- `server/src/domain/estimateBaseCost.ts` — `estimateBaseCost(event, deps)`, `medianCents`, `coldStartCost` (offline null fallback) — unknown-amount chain: stated → txn history median → RAG (`deps.rag`) → web cold start (`deps.coldStart`) → null
- `server/src/domain/ragCost.ts` — `quotePerPersonCents`, `pickPerPersonCents`, `quotesStatedInText`, `dollarAmountsIn`, `statedPerPerson` — pure math over RAG price quotes (same venue preferred, median); guard: quoted figures must appear in the message text

## Seed (Stream A)
- `seed/scenario.json` — single source of truth for the demo data (22 events: all 12 BUILDPLAN §6 scenarios + RAG and web cost cases; `expected.costSource`)
- `seed/truth.json` — generated ground truth: per-friend totals, per-event ledger, expected review items
- `server/src/seed/scenario.ts` — `Scenario` and friends — zod schema for scenario.json
- `server/src/seed/generate.ts` — `generateSeed(scenario)`, `seedFiles(seed)`, `toMojibake`, `Truth*` types — pure deterministic generator
- `server/src/seed/oracle.ts` — `equalShares`, `splitEdges`, `medianCents` — independent truth oracle (deliberately separate from domain/split.ts)
- `server/src/seed/push.ts` — `pushNessie(data, writer)` — push seed to live Nessie (H2)
- `server/test/tempSeed.ts` — `writeTempSeed()` — generated seed files in a temp dir for tests

## Sources and ingest
- `server/src/sources/instagram.ts` — `InstagramMessageSource(dir)`, `fixMojibake(s)` — IG export reader
- `server/src/sources/nessie.ts` — `NESSIE_PATHS`, `NessieHttpClient`, `NessieFileSource`, `NessieWriter`, `NessieData` — Nessie access (all paths in one map, H6)
- `server/src/sources/calendar.ts` — `FileCalendarSource(path)`
- `server/src/sources/people.ts` — `FilePeopleSource`, `loadPeople`, `PersonSeed` — contacts list (identity source)
- `server/src/sources/index.ts` — `defaultSources(config)` — builds sources from env
- `server/src/pipeline/ingest.ts` — `ingest(db, sources)`, `resolvePerson(db, kind, value)`, `normAlias(v)` — raw tables + alias resolution, idempotent

## LLM (Stream B)
- `server/src/llm/client.ts` — `generateStructured(db, prompt, input, opts?)`, `LlmClient`, `cacheKey`, `canonicalJson`, `retryable` — the one LLM client (provider-neutral): cache → fixture (replay) → live with retry/repair
- `server/src/llm/muse.ts` — `createMuseClient`, `createMuseGroundedClient`, `MuseApiError`, `reasoningParams`, `chatRequestBody`, `groundedRequestBody`, `parseChatResponse`, `parseGroundedResponse` — the one generation provider adapter (Meta Model API / Muse over HTTP: Chat Completions + json_schema, Responses + web_search)
- `server/src/llm/prompts/{messageDay,txnSocial,mergeDay,repayments}.ts` — PromptDefs + input types; `validateMergeGroups` (messageDay is v2: adds `perPersonAmountDollars`, `payers[]`)
- `server/src/llm/prompts/util.ts` — `slug`, `ValidatedPromptDef`, `RULES`, `json`
- `server/src/llm/schemas/*.ts` — zod output schemas
- `server/src/llm/index.ts` — re-exports
- `server/test/fixtures/llm/<promptId>/<fixtureKey>.json` — hand-written replay fixtures for the seed scenario

## Pipeline (Phase 4)
- `server/src/pipeline/protoEvents.ts` — `buildProtoEvents(db, opts)` — thread×day messageDay, calendar direct, purchases via txnSocial → `proto_event`
- `server/src/pipeline/merge.ts` — `mergeEvents(db, opts)`, `findEvidenceMessage`, `singleProtoGroup` (skips the LLM on unambiguous single-proto days) — per-day mergeDay → `event`/`event_source`/`event_payer`
- `server/src/pipeline/relevance.ts` — `evaluateEvent`, `runRelevance`, `attendeesReviewId` — relevance rule + attendees review items
- `server/src/pipeline/attribution.ts` — `attributeEvent`, `runAttribution`, `detectRepayments`, `dbBaseCostDeps`, `payerReviewId` — payer basis rules, estimateBaseCost with DB history, repayments (message + transfer, deduped)
- `server/src/pipeline/ledger.ts` — `rebuildEventLedger(db, id)`, `runLedger(db)` — splitEvent → `ledger_entry`, idempotent per event
- `server/src/pipeline/run.ts` — `runPipeline(db, {from?, llmMode?, sources?})`, `Stage`, `STAGES`, `resetPipelineTables` — orchestrator
- `server/src/pipeline/review.ts` — `applyReviewAnswer(db, id, body)`, `reprocessEvent(db, eventId)` — persist answer, re-run only the affected event
- `server/src/sources/index.ts` — `sourcesFromDir(generatedDir)` — file sources over a seed `generated/` dir
- `server/src/seed/write.ts` — `writeSeed(seedDir?)`, `loadScenario()` — shared by seed/demo/eval
- `server/src/cli/{run-pipeline,eval,demo,llm-smoke}.ts` — `pnpm --filter server pipeline|eval|demo` and live Muse smoke test (structured output + web search)

## Retrieval and cost baseline (DESIGN §11)
- `server/migrations/002_message_vectors.sql` — `message.embedding_vec vector(768)` + HNSW cosine index (guarded), `message.embedding_model`, `embedding_cache`
- `server/src/llm/embed.ts` — `Embedder`, `getEmbedder(mode)`, `localEmbedder()`, `geminiEmbedder()`, `embedTexts(db, texts, e)`, `EMBED_DIMS` — the one embedder (local deterministic stand-in or live Gemini — the only Gemini use left; Meta has no embedding model), cached
- `server/src/pipeline/embed.ts` — `embedMessages(db, opts)`, `hasVectorColumn(db)` — pipeline stage `embed` (after ingest)
- `server/src/pipeline/retrieval.ts` — `searchMessages(db, query, opts)`, `setSearchEmbedder`, `MessageHit`, `SearchOptions` — semantic message search (pgvector, JS cosine fallback)
- `server/src/pipeline/cost.ts` — `ragHistoryCost`, `ragQuery`, `webColdStartCost` — RAG and web-search steps behind estimateBaseCost
- `server/src/llm/webSearch.ts` — `generateGrounded`, `GroundedClient` — web-search-grounded lookups (default client: Muse, `llm/muse.ts`) with cache + replay fixtures
- `server/src/llm/prompts/{costFromSnippets,webCost}.ts`, `server/src/llm/schemas/{costFromSnippets,webCost}.ts` — RAG quote extraction and web price extraction

## Observability
- `server/src/obs/tracing.ts` — `tracingEnabled`, `traced`, `runTraced`, `annotateRun`, `wrapGenAI`, `flushTraces`, `getTracingClient`, `setTracingClient` — the one LangSmith tracing module; no-op unless `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` set
- `server/src/llm/client.ts` — `traceLlmCall`, `LlmSource` — `llm:<promptId>` chain runs recording source (cache|fixture|live); `muse:chat` / `muse:web_search` llm runs (with token usage) come from `llm/muse.ts`
- `server/test/env.test.ts` — guard: every config env var is documented in `.env.example`

## Payback suggestions (DESIGN §15/§16)
- `server/migrations/003_payback.sql` — `future_event`, `recurring_pattern`, `price_quote` (SerpAPI cache), `payback_candidate`, `payback_suggestion`, `payback_dismissal` — all derived or cache except dismissals; nothing here is a source of truth for debt
- `packages/shared/src/api.ts` — `PaybackResponse`, `PaybackSuggestion`, `PaybackItem`, `PaybackKind`, `FriendSummary.paybackCount` — payback DTOs (cents; shares are the friend's share of an outing)
- `server/src/pipeline/payback.ts` — `runPayback(db, opts)`, `solveFriend(db, friendId)`, `dismissSuggestion(db, id)`, `friendShareCents`, `activityKey` — pipeline stage `payback` (after `ledger`) and the read path behind `GET /friends/:id/payback`; only LLM call is `planFinder`
- `server/src/domain/payback.ts` — `solvePayback(debt, options, cfg)`, `toleranceCents`, `TRUST` (planned 1 / discovered 0.9 / recurring ≤ 0.5 × regularity), `isNovel` — pure bundle solver
- `server/src/domain/plans.ts` — `acceptMessagePlan`, `mergePlans` — pure rules for chat plans (real future date, in horizon, not friend-paid, cites real messages) and calendar/chat dedupe
- `server/src/domain/recurrence.ts` — `detectPatterns`, `addDays`, `daysBetween` — pure cadence detection, rolls next date past `asOf`
- `server/src/domain/serpPrice.ts` — `eventsFromSerp`, `placesFromSerp`, `parseDollarRange`, `resolveMonthDay`, `PRICE_LEVEL_BANDS` — pure SerpAPI response extraction
- `server/src/sources/serpapi.ts` — `SerpApiClient`, `replayClient`, `liveClient`, `cachedSerp`, `SerpReplayMiss`, `SerpBudgetExceeded`, `fixtureName` — the one SerpAPI adapter; `TODO(stub): serpapi-live` (untested without a key, H13)
- `server/src/llm/prompts/planFinder.ts`, `server/src/llm/schemas/planFinder.ts` — `planFinder` prompt: concrete future plans from a chat thread
- `server/src/config.ts` — `getAsOf()` (the demo clock, `AS_OF_DATE`), `SERPAPI_*`, `HOME_CITY`, `PAYBACK_*`
- `server/test/fixtures/serpapi/<engine>__<slug(query)>.json` — hand-written SerpAPI replay fixtures (not captured responses); `server/test/fixtures/llm/planFinder/<asOf>__<thread>.json`
- `seed/scenario.json` — `plans` (future calendar entries) and `planMessages` (chat mentions of future plans); `x-alex-hamilton` is the demo debt (Alex covered $540, Me owes Alex $94.66)

## API
- `server/src/api/server.ts` — `startServer(db, {port?, llmMode?})` — listen on a migrated Db
- `server/src/db/queries.ts` — `listPersons`, `listLedgerEntries`, `getFriendSummaries`, `getFriendDetail`, `listOpenReviewItems` — typed reads mapped to shared DTOs
- `server/src/api/app.ts` — `buildApp({db, llmMode?})` — Fastify app, all BUILDPLAN §7 routes
- `server/src/api/main.ts` — server entry (`pnpm --filter server dev`)

## App (Expo)
- `app/src/api/client.ts` — `getFriends`, `getFriend`, `getReview`, `answerReview`, `API_URL`, `USE_MOCKS` — the only app data access; API base = `EXPO_PUBLIC_API_URL`, else the Expo dev host on :3000 (works on phones); `EXPO_PUBLIC_USE_MOCKS=1` → mocks
- `app/src/api/hooks.ts` — `useFriends`, `useFriend`, `useReview`, `useAnswerReview` — TanStack Query hooks
- `app/src/mocks/index.ts` — `mockApi` — in-memory mock backend
- `app/src/format.ts` — `formatCents`, `balanceLabel`, `formatDate`, `formatDateTime` — the one money formatter
- `app/src/theme.ts` — `colors`, `space`, `radius`
- `app/src/components/ui.tsx` — `Loading`, `ErrorState`, `EmptyState`, `Badge`
