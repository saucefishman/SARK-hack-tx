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
- `server/src/config.ts` — `getConfig()`, `REPO_ROOT` — the one env loader (zod, fail fast)
- `server/src/db/pool.ts` — `Db`, `createDb(url)`, `getDb()` — the one DB handle; `postgres://` → pg, `pglite://dir|memory` → embedded PGlite
- `server/src/db/migrate.ts` — `migrate(db)` — applies `migrations/*.sql` in order
- `server/test/helpers.ts` — `testDb()` — fresh in-memory migrated DB for tests

## Domain (pure)
- `server/src/domain/balance.ts` — `friendTotals(friendId, entries)` — spent on you / you spent / balance / possible per friend
- `server/src/domain/money.ts` — `dollarsToCents(n)`, `formatCents(c)` — dollar→cent boundary conversion; log formatting
- `server/src/domain/ids.ts` — `stableId(prefix, ...parts)`, `eventId({date, attendeeIds, anchor})` — deterministic ids (sha256)
- `server/src/domain/relevance.ts` — `isRelevant(...)`, `needsAttendeeReview(...)` — binary relevance rule (DESIGN §4)
- `server/src/domain/split.ts` — `splitEvent({attendeeIds, payers, onlyTouching?})`, `allocate(total, weights)` — 6d equal split + multi-payer netting, largest-remainder cents
- `server/src/domain/estimateBaseCost.ts` — `estimateBaseCost(event, deps)`, `medianCents`, `coldStartCost` (TODO(stub): muse-cold-start) — unknown-amount chain: stated → history median → cold start → null

## Seed (Stream A)
- `seed/scenario.json` — single source of truth for the demo data (20 events, all 12 BUILDPLAN §6 scenarios)
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
- `server/src/llm/gemini.ts` — `generateStructured(db, prompt, input, opts?)`, `LlmClient`, `createGeminiClient`, `cacheKey`, `canonicalJson` — the one Gemini client: cache → fixture (replay) → live with retry/repair
- `server/src/llm/prompts/{messageDay,txnSocial,mergeDay,repayments}.ts` — PromptDefs + input types; `validateMergeGroups`
- `server/src/llm/prompts/util.ts` — `slug`, `ValidatedPromptDef`, `RULES`, `json`
- `server/src/llm/schemas/*.ts` — zod output schemas
- `server/src/llm/index.ts` — re-exports
- `server/test/fixtures/llm/<promptId>/<fixtureKey>.json` — hand-written replay fixtures for the seed scenario

## API
- `server/src/db/queries.ts` — `listPersons`, `listLedgerEntries`, `getFriendSummaries`, `getFriendDetail`, `listOpenReviewItems` — typed reads mapped to shared DTOs
- `server/src/api/app.ts` — `buildApp({db, llmMode?})` — Fastify app, all BUILDPLAN §7 routes
- `server/src/api/main.ts` — server entry (`pnpm --filter server dev`)

## App (Expo)
- `app/src/api/client.ts` — `getFriends`, `getFriend`, `getReview`, `answerReview`, `API_URL`, `USE_MOCKS` — the only app data access (`EXPO_PUBLIC_USE_MOCKS=1` → mocks)
- `app/src/api/hooks.ts` — `useFriends`, `useFriend`, `useReview`, `useAnswerReview` — TanStack Query hooks
- `app/src/mocks/index.ts` — `mockApi` — in-memory mock backend
- `app/src/format.ts` — `formatCents`, `balanceLabel`, `formatDate`, `formatDateTime` — the one money formatter
- `app/src/theme.ts` — `colors`, `space`, `radius`
- `app/src/components/ui.tsx` — `Loading`, `ErrorState`, `EmptyState`, `Badge`
