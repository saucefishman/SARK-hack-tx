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
