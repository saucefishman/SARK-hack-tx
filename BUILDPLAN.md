# BUILDPLAN — How Much Do Your Friends Cost? (MVP)

Audience: a Claude agent building the project. Read `CLAUDE.md`, `DESIGN.md` and `STRUCTURE.md` first. `DESIGN.md` says **what** and **why**; this file says **how**, in order. If they conflict, `DESIGN.md` wins; change it in the same commit when you deliberately diverge, because schemas are contracts other people depend on.

Product in one line: a React Native app showing, per friend, how much they've spent on the user (headline), how much the user spent on them, and the balance, computed from synthetic Nessie transactions plus an Instagram message export, using Gemini for extraction.

Contents: 1 Stack · 2 Repo layout · 3 Human-only tasks · 4 Env vars · 5 Phases · 6 Seed data spec · 7 Server API · 8 Mobile app · 9 Testing and verification · 10 Rules for the agent

---

## 1. Stack (decided, do not re-litigate)

| Concern | Choice |
|---|---|
| Mobile | React Native via **Expo** (managed workflow), TypeScript, **Expo Router**, **TanStack Query**, plain `StyleSheet` |
| Backend | Node 20+, TypeScript, **Fastify**, `pg`, `zod` |
| Pipeline | Same server package, run as CLI scripts (batch). Not a live request path. |
| DB | **Tiger Data** (managed Postgres). Plain `.sql` migrations. pgvector extension enabled but unused in MVP. |
| LLM | **Google Gemini** via the `@google/genai` SDK, structured output (JSON schema) only, temperature 0 |
| Banking data | **Nessie** REST API, base `https://prod-api.nessieisreal.com`, key as `?key=` query param |
| Messages | Instagram "Download your information" JSON export, parsed from a local folder |
| Calendar | **Optional.** MVP reads calendar from a local JSON file in Google Calendar event shape. Real Google Calendar OAuth is a stretch (section 3). |
| Tests | **vitest** (server + shared). Manual checks for the app via the iOS simulator tool. |
| Package manager | **pnpm** workspaces |

Gemini model id goes in `GEMINI_MODEL` (default `gemini-2.5-flash`). Model names change; a human should confirm the current id in Google AI Studio (section 3).

---

## 2. Repo layout

```
/
├─ CLAUDE.md  DESIGN.md  BUILDPLAN.md  STRUCTURE.md  .env.example
├─ pnpm-workspace.yaml
├─ packages/
│  └─ shared/            # types + zod schemas: Person, Event, EventPayer, LedgerEntry, ReviewItem, API DTOs
├─ server/
│  ├─ migrations/        # 001_init.sql ...
│  ├─ src/
│  │  ├─ db/             # pool, migrate runner, queries
│  │  ├─ sources/        # MessageSource (instagram.ts), NessieClient, CalendarSource (file.ts)
│  │  ├─ llm/            # gemini.ts (client + cache), prompts/, schemas/
│  │  ├─ pipeline/       # ingest, protoEvents, merge, relevance, attribution, ledger, run.ts
│  │  ├─ domain/         # pure functions: split.ts (6d rule), balance.ts, estimateBaseCost.ts
│  │  ├─ api/            # Fastify routes
│  │  └─ cli/            # seed.ts, run-pipeline.ts, eval.ts
│  └─ test/
├─ seed/                 # scenario.json (single source of truth), truth.json, generated/ (git-ignored)
└─ app/                  # Expo app
```

One of each shared thing: types only in `packages/shared`, one DB pool, one Gemini client, one config loader (`server/src/config.ts`, reads env, fails fast on missing vars).

---

## 3. Human-only tasks (Claude cannot do these without a person)

The agent must not invent, hardcode, or guess any of these. When blocked on one, stop that workstream, say exactly what is needed, and continue with unblocked work (use the fakes in the "Until then" column).

| # | Task | Why Claude can't | Who | Until then, the agent does |
|---|---|---|---|---|
| H1 | Create the **Tiger Data** account and a Postgres service; copy the connection string into `.env` as `DATABASE_URL`; confirm the `vector` extension can be created (`CREATE EXTENSION vector;`) | Needs signup, billing/free tier, a secret | Human | Develop against local Postgres (Docker or Homebrew, with `DATABASE_URL` pointing at it). Migrations must run unchanged on both. |
| H2 | Get a **Nessie API key**: log in at nessieisreal.com with GitHub, copy the key into `.env` as `NESSIE_API_KEY` | Needs the human's GitHub login | Human | Build `NessieClient` against the documented shapes with an in-memory fake; write the seed generator to output both Nessie POST payloads and a local JSON fallback. |
| H3 | Get a **Gemini API key** from Google AI Studio; set `GEMINI_API_KEY`; confirm the model id for `GEMINI_MODEL` | Needs the human's Google account | Human | Implement the Gemini client with a **record/replay cache** (section 5, Phase 3) and write prompts and schemas. Commit hand-written fixture responses so the pipeline tests run without a key. |
| H4 | Install toolchain on the dev machine: Node 20+, pnpm, Xcode + iOS Simulator (or Android Studio), Docker (if used for local Postgres), and **Expo Go** on a physical phone if demoing on a device | OS installs, Apple ID, passwords | Human | Verify with `node -v` etc. and report what's missing. |
| H5 | **Phone demo networking**: a physical phone needs to reach the server. Give the dev machine's LAN IP, or start a tunnel, and set `EXPO_PUBLIC_API_URL` | Network and device access | Human | Use `http://localhost:PORT` for the simulator. |
| H6 | **Confirm Nessie per-account endpoints** for listing/creating purchases (the docs pages for Purchases and Transfers only list by-ID routes). Needs the key to try them in the interactive docs at nessieisreal.com/docs | Needs H2 | Human or agent once H2 exists | Isolate all Nessie paths in `NessieClient` so a wrong path is a one-line fix. |
| H7 | **Instagram export** (only if using a real account for anything): request via Instagram app → Your activity → Download your information → Messages only → JSON. Arrives by email in hours to days | Needs account login, email, wait time | Human | MVP uses a **fake export in Instagram's format** generated by the seed script. Real export is optional and out of the demo path ("no real data"). |
| H8 | **Google Calendar OAuth** (stretch only): Google Cloud project, enable Calendar API, OAuth consent screen, client id/secret, human consent click | Needs Google Cloud console and consent | Human | Use `CalendarSource` reading `seed/generated/calendar.json`. |
| H9 | **Demo decisions**: names of the fake friends, tone of the UI copy, what story the demo tells, what the pitch says about privacy | Product judgment | Team | Use the defaults in section 6 and flag them as placeholders. |
| H10 | **Git and team operations**: creating the remote, pushing, opening PRs, merging, resolving coordination with teammates' parallel sessions | Outward-facing and shared; commit/push only when asked | Human | Commit locally only when asked; never push. |
| H11 | **Physical-device and visual QA**: Claude can drive the iOS Simulator, but cannot judge feel on a real phone or a projector | Needs eyes and hardware | Human | Take simulator screenshots and report. |
| H12 | **Cost/limits decisions**: confirm free-tier Gemini and Tiger Data limits are acceptable for the demo | Billing | Human | Keep call volume small by design (~20 events, cache everything). |
| H13 | **SerpAPI key** (serpapi.com signup; the free tier is small). Set `SERPAPI_API_KEY` and `SERPAPI_MODE=live`, then confirm the `google_events` and `google_maps` params and response fields in their playground against `server/src/domain/serpPrice.ts` | Needs signup, billing, a secret | Human | Run with `SERPAPI_MODE=replay` (default) and the hand-written fixtures in `server/test/fixtures/serpapi/`. The live client is `TODO(stub): serpapi-live` until then. |

Secrets rule: never commit secrets. They live in `.env` (git-ignored). `.env.example` lists every variable with a placeholder.

---

## 4. Environment variables (`.env.example`)

```
DATABASE_URL=postgres://user:pass@host:5432/dbname      # H1
NESSIE_API_KEY=                                          # H2
NESSIE_BASE_URL=https://prod-api.nessieisreal.com
GEMINI_API_KEY=                                          # H3
GEMINI_MODEL=gemini-2.5-flash                            # confirm in H3
LLM_MODE=live                                            # live | replay  (replay = use cache only, error on miss)
MESSAGES_DIR=./seed/generated/instagram                  # folder shaped like an IG export
CALENDAR_FILE=./seed/generated/calendar.json
PORT=3000
EXPO_PUBLIC_API_URL=http://localhost:3000                # H5 for phones
# Payback suggestions (DESIGN §15/§16). Authoritative list: .env.example
AS_OF_DATE=2026-10-25                                    # demo clock; unset = today
SERPAPI_API_KEY=                                         # H13
SERPAPI_MODE=replay                                      # live | replay
SERPAPI_MAX_CALLS=20  HOME_CITY=Austin, Texas  PAYBACK_TOLERANCE_PCT=10  PAYBACK_TOLERANCE_MIN_CENTS=1000  PAYBACK_MAX_BUNDLE=3
```

---

## 5. Phases

Each phase ends with: tests pass, `STRUCTURE.md` updated, schemas (if touched) reflected in `DESIGN.md`. Work streams A–D from `DESIGN.md` section 10 can run in parallel after Phase 0.

### Phase 0 — Scaffold and freeze contracts (do first, ~1 hour)

1. `pnpm` workspace, `packages/shared`, `server`, `app` (Expo, TypeScript template).
2. `server/src/config.ts`: load env with `zod`, fail fast.
3. `migrations/001_init.sql` creating the tables in `DESIGN.md` section 5: `person`, `person_alias`, `message`, `calendar_event`, `txn`, `proto_event`, `event`, `event_source`, `event_payer`, `ledger_entry`, `review_item`, `canonical_event` (empty stub). Add `CREATE EXTENSION IF NOT EXISTS vector;` guarded so it doesn't fail on a DB without it. Add one implementation-only table, `llm_cache(key text primary key, model text, response jsonb, created_at timestamptz)`, and mention it in `DESIGN.md`.
4. Migration runner: reads `migrations/*.sql` in order, tracks applied files in a `schema_migrations` table.
5. `packages/shared`: TypeScript types and zod schemas mirroring the tables, plus API DTOs (section 7). **This is the contract. Freeze it, record it in `STRUCTURE.md`.**
6. Mark stubs from `DESIGN.md` 11b: `person.platform_user_id`, `event.owner_user_id`, `event.canonical_event_id`, `canonical_event`, and `estimateBaseCost()`, each with `TODO(stub): social`.
7. `.env.example`, `.gitignore` (`.env`, `seed/generated/`, `node_modules`, Expo build output).

Done when: `pnpm install` works, migrations apply on a clean local Postgres, `pnpm -r typecheck` passes.

### Phase 1 — Seed data (Stream A, can start with no keys)

Implements section 6.

1. `seed/scenario.json`: the single source of truth for fake friends, events, who paid, amounts, messages, repayments.
2. `server/src/cli/seed.ts` generates from the scenario:
   - `seed/generated/instagram/` in Instagram export shape (section 6).
   - `seed/generated/calendar.json` in Google Calendar event shape.
   - `seed/generated/nessie.json`: customers, accounts, merchants, purchases, transfers as Nessie payloads.
   - `seed/truth.json`: ground truth (per event: true attendees, payers, per-person split; per friend: true balance).
3. With H2 available: `seed --push-nessie` creates customer → account → merchants → purchases/transfers in Nessie via `NessieClient`. Without it: skip, and ingest reads `nessie.json` directly (`NESSIE_SOURCE=file`).

Done when: running the seed twice yields identical files (deterministic, no `Math.random`), and `truth.json` balances are computable by hand from `scenario.json`.

### Phase 2 — Ingest (Stream A)

1. `sources/instagram.ts` implements `MessageSource`: `listMessages(): AsyncIterable<RawMessage>`. Parse `messages/inbox/<thread>/message_*.json`. Known quirk: Instagram exports encode non-ASCII text as mis-decoded latin-1 (mojibake); decode by re-interpreting each string as latin-1 bytes then UTF-8. Timestamps are `timestamp_ms`. Fields used: `sender_name`, `timestamp_ms`, `content`.
2. `sources/nessie.ts`: `NessieClient` with `getCustomers`, `getAccounts`, `getPurchases(accountId)`, `getTransfers(accountId)`, `getMerchants`, plus create variants for seeding. All paths in one place (H6). Also a file-backed implementation with the same interface.
3. `sources/calendar.ts` implements `CalendarSource` from `calendar.json`.
4. `pipeline/ingest.ts`: load everything into `message`, `calendar_event`, `txn`; resolve names to `person` via `person_alias` (display name, merchant text, email). Unknown strings create a candidate alias and a `review_item` (kind: `alias`).
5. Idempotent: upsert on source ids.

Note Nessie purchases have **date only, no time** and no counterparty. Treat `txn.occurred_at` as a date; all matching is same-day.

Done when: after ingest, row counts match the scenario and re-running changes nothing.

### Phase 3 — Gemini layer (Stream B)

1. `llm/gemini.ts`: `generateStructured<T>({ promptId, input, schema })`.
   - Prompt templates in `llm/prompts/*.ts`; each has a version string.
   - Response schemas in `llm/schemas/*.ts` (zod, converted to the SDK's JSON schema); temperature 0.
   - **Cache** key = sha256(promptId + promptVersion + model + canonical JSON of input). Read/write `llm_cache`. `LLM_MODE=replay` errors on miss so tests and demos never hit the network.
   - Retry with backoff on 429/5xx; validate output with zod, one repair retry, then fail loudly.
2. Prompts (each a pure function `input → prompt`, with the schema alongside):
   - `messageDay`: one day's messages in a thread → `{ events: [{ date, people[], description, time?, payer?, amountMentioned?, coveredPhrases[], paymentMentions[], sourceMessageIds[] }] }`. Mentioned amounts are only what the text states; never compute.
   - `txnSocial`: merchant + category + amount + date + same-day sibling transactions → `{ looksSocial, reason }`.
   - `mergeDay`: that day's proto events (all sources) → `{ groups: [{ protoEventIds[], description, attendees[], payers: [{person, amount?, basis}], total? , confidence }] }`. Validate that every proto event id appears exactly once.
   - `repayments`: later messages in the thread, outstanding debts → `[{ messageId, from, to, amount?, note }]`.
3. Hand-write fixture responses for the seed scenario into `server/test/fixtures/llm/` so tests and CI run with `LLM_MODE=replay` and no key.

Done when: with fixtures, `generateStructured` returns validated objects; with a key (H3), a live smoke test on one day of seed messages returns schema-valid output.

### Phase 4 — Events, relevance, attribution (Stream B + C)

MVP simplification from `DESIGN.md` 1b: each social transaction anchors its own event, with same-day calendar and message proto events attached; message-only events with a friend payer are created from messages.

1. `pipeline/protoEvents.ts`: write `proto_event` rows per source via the prompts above.
2. `pipeline/merge.ts`: per day, call `mergeDay`; create `event`, `event_source`, `event_payer`. Event id = deterministic hash (date + sorted attendee ids + anchor txn id or first message id).
3. `pipeline/relevance.ts`: `is_relevant = attendees ≥ 2 AND paid AND source_count ≥ 2` (`DESIGN.md` 4). Pure function with a unit test table. Events failing it are kept but excluded from the ledger. Transaction-only social events become `review_item` (kind `attendees`).
4. `domain/split.ts` (**pure, heavily unit-tested**): input = `{ attendees, payers: [{person, amount}] }`, output = directional pairs per `DESIGN.md` 6d:
   - fair share = total / headcount; surplus = paid − share; debtors repay creditors pro rata to creditor surplus.
   - Amounts in integer cents internally; distribute rounding remainders deterministically (largest remainder, ties by person id).
   - Keep only pairs where one side is the user.
5. `pipeline/attribution.ts`:
   - User paid (6b): from the Nessie txn.
   - Friend paid (6c): `basis` rules: explicit + amount → `confirmed`; explicit, no amount → `estimateBaseCost` → `estimated`; implicit (social event, no user txn) → pick assumed payer per 6d, `basis = assumed`, create `review_item` (kind `payer`).
   - `domain/estimateBaseCost.ts`: message-stated amount → median of the user's past spend at the same merchant/event type (history search) → **cold-start search** → null. The cold-start step is a separate function `coldStartCost(merchant, eventType)` behind an interface: it calls Muse's web-search tool (or SerpAPI), has Gemini return `{perPersonCents, sourceUrl, confidence}` as structured output, and caches by merchant + event type. MVP: stub that returns null, marked `TODO(stub): muse-cold-start`; do not call out to the network. Stub marker `TODO(stub): social` at the top of the chain.
   - Repayments via the `repayments` prompt and via Nessie transfers whose `description` names a friend: write `kind = repayment` rows.
   - Anything unexplained: `kind = unaccounted`.
6. `pipeline/ledger.ts` + `domain/balance.ts`: per friend, `spent_on_you`, `you_spent_on_them`, `balance` (positive = friend owes user), `possible` (sum of `assumed` rows, **excluded** from balance). Rebuild per event idempotently (delete the event's entries, reinsert).
7. `cli/run-pipeline.ts`: runs ingest → protoEvents → merge → relevance → attribution → ledger, logging counts per stage. Flags: `--from <stage>`, `--llm replay|live`.
8. Review answers (`POST /review/:id/answer`, section 7) re-run only the affected event through relevance → attribution → ledger, and persist resolved aliases.

Done when: on the seed scenario with replay fixtures, ledger balances equal `truth.json` for every friend (exact, in cents).

### Phase 5 — API (Stream C/D boundary)

Implement section 7. Fastify with zod validation from `packages/shared`. No auth in MVP; single user (`owner_user_id` is a constant, stub).

Done when: route tests (Fastify `inject`) pass against the seeded DB.

### Phase 6 — Mobile app (Stream D)

Implement section 8. Can start in Phase 1 against a mock API (`app/src/mocks`) shaped by `packages/shared` DTOs, then switch to the real server by env flag.

### Phase 7 — Eval and demo hardening

1. `cli/eval.ts`: run the pipeline in replay (and optionally live), compare to `truth.json`, print attendee accuracy, payer accuracy, per-friend balance error. Exit non-zero if any balance differs in replay mode.
2. Precompute: run live once, let the cache fill, commit nothing secret. Demo runs with `LLM_MODE=replay`, so Gemini limits and latency never matter on stage.
3. One-command demo: `pnpm demo` = migrate → seed → pipeline (replay) → start server.
4. Add the "heuristic estimates" disclaimer in the UI (`DESIGN.md` 8).

### Phase 8 — Payback suggestions (`DESIGN.md` §15/§16)

Backend built; app card not. Stage `payback` runs after `ledger`. Priority: planned (calendar + chat) and SerpAPI ideas share the top tier, recurring is the fallback.

1. Done: migration `003_payback.sql`; `domain/{payback,plans,recurrence,serpPrice}.ts` (pure, table-tested); `planFinder` prompt + fixtures; `sources/serpapi.ts` (replay + live, per-day cache, call budget); `pipeline/payback.ts`; `GET /friends/:id/payback`, `POST /payback/:id/dismiss`; seed debt (`x-alex-hamilton`), future plans and chat plans.
2. Open, app owner: debt-led "Ways to pay it back" card using `PaybackResponse`. Labels: planned → "planned", discovered → "new idea", recurring → "tried and true".
3. Open: interests from the pair's messages to replace merchant-category queries (`TODO(stub): interests-llm`); live SerpAPI check (H13).

### Stretch (only if all above is done)

Real Google Calendar OAuth (H8); calendar as a true third source in merge; review-queue polish; cost-of-friendship extras. Do **not** start social expansion beyond the stubs.

---

## 6. Seed data spec

Single user `Me` and four invented friends (placeholders, H9): **Alex, Sam, Jordan, Riley**. About 20 events over ~3 months, all generated from `scenario.json`. Whole-dollar amounts (Nessie `amount` is an integer).

Scenarios the data **must** contain (each is a test case and a demo moment):

| # | Scenario | Exercises |
|---|---|---|
| 1 | Me paid $120 dinner for Me+Alex+Sam+Jordan; thank-you messages | 6b happy path |
| 2 | Alex repays $30 by message "sent you $30" | message repayment |
| 3 | Sam repays $30 via a Nessie transfer whose description names Sam | transfer repayment |
| 4 | Sam paid $84 for Me+Sam+Riley; message "dinner's on me, was $84" | 6c explicit with amount, `confirmed` |
| 5 | Jordan: "I got this one" at a bar, no amount stated | explicit, no amount → `estimated` via history |
| 6 | Calendar event + chatter about a concert, no Me transaction, nobody says who paid | implicit → `assumed` + review item |
| 7 | Two friends paid parts of one bill ($60 + $40, 4 people) | multi-payer split (6d) |
| 8 | Lunch and dinner same day with different groups | merge must not collapse them |
| 9 | Solo grocery purchase | not social → irrelevant, stored but excluded |
| 10 | A $70 restaurant transaction with no messages or calendar | transaction-only → review item |
| 11 | A message that mentions a payment amount that belongs to a different event | guard against wrong attribution |
| 12 | Friend nickname in messages differs from calendar attendee name | alias resolution |

Both directions must be present so the headline "spent on you" and the counterweight both have numbers.

**Instagram export shape** (what the generator writes and the parser reads):

```
instagram/messages/inbox/<thread_name>_<id>/message_1.json
{
  "participants": [{ "name": "Alex" }, { "name": "Me" }],
  "messages": [
    { "sender_name": "Alex", "timestamp_ms": 1710272400000, "content": "..." }
  ],
  "title": "Alex",
  "thread_path": "inbox/Alex_abc123"
}
```

Group threads have more participants. The generator must also produce one string with non-ASCII characters in mojibake form to test the decoder.

---

## 7. Server API

All JSON, DTOs in `packages/shared`. Money in **integer cents** on the wire; the app formats to dollars. Sign convention: `balanceCents` positive = friend owes user.

| Method and path | Returns |
|---|---|
| `GET /friends` | `[{ personId, name, spentOnYouCents, youSpentOnThemCents, balanceCents, possibleCents, eventCount }]`, sorted by `spentOnYouCents` desc |
| `GET /friends/:id` | `{ friend, entries: [{ event: {id, date, description, attendees}, payerName, beneficiaryName, amountCents, kind, basis, confidence, evidence: [{messageId, snippet, sentAt}] }] }` |
| `GET /review` | `[{ id, kind, question, options?: [{personId, name}], eventSummary }]` open items |
| `POST /review/:id/answer` | body `{ personIds?: string[], payerId?: string, dismiss?: boolean }`; triggers the affected-event re-run; returns the updated `GET /friends` row(s) |
| `GET /health` | `{ ok: true, llmMode }` |
| `POST /dev/rerun` | dev only; runs the pipeline in replay mode |

---

## 8. Mobile app (Expo)

Screens (Expo Router, bottom tabs):

1. **Friends** (home). One card per friend. Headline = "spent on you $X" large; secondary "you spent $Y"; badge with net: "you owe $Z" or "owes you $Z" or "even". A "Possible $N" chip when `possibleCents > 0`. Header line shows totals. Pull to refresh.
2. **Friend detail** (push from a card). List of entries grouped by event: date, description, who paid whom, amount, a `basis` badge (confirmed / estimated / possible), and an expandable "receipts" section showing the message snippets. Footer note: "Estimates are heuristic. Splits assume equal shares."
3. **Review** tab, with a badge count. Each item is a card with a question and tappable friend chips (multi-select for attendees, single for payer) plus "Not social / dismiss". Submitting calls `POST /review/:id/answer` and refreshes Friends.

Implementation notes:
- Data access only through `app/src/api/client.ts` (typed with shared DTOs) and TanStack Query hooks. `EXPO_PUBLIC_API_URL` sets the base.
- Money formatting in one helper (`formatCents`), used everywhere.
- Neutral copy ("balance", "spent on you"), not "cost you" (`DESIGN.md` 8).
- Loading, empty, and error states for every query.
- No auth, no push notifications, no offline mode in MVP.

Done when: on the iOS Simulator the Friends list matches `truth.json`, the detail screen shows receipts, answering a review item changes the numbers.

---

## 9. Testing and verification

- **Pure functions first**: `split`, `balance`, `relevance`, `estimateBaseCost`, Instagram decoder. Table-driven vitest. Include rounding cases (e.g. $100 / 3) and multi-payer cases.
- **Pipeline test**: seed → pipeline with `LLM_MODE=replay` fixtures → compare to `truth.json` in cents. This is the main correctness gate.
- **API tests**: Fastify `inject` against a test database.
- **App check**: run the server with seeded data, launch the app in the iOS Simulator (use the simulator tool), screenshot Friends, detail and Review, and compare numbers to `truth.json`. Report what was and wasn't checked; do not claim device-level QA (H11).
- **Live Gemini smoke test**: only when H3 is done; otherwise state it was not run.
- Commands the repo must provide: `pnpm -r typecheck`, `pnpm -r test`, `pnpm demo`, `pnpm --filter server eval`.

---

## 10. Rules for the agent

1. Before creating anything reusable, check `STRUCTURE.md` and grep. Update `STRUCTURE.md` in the same commit as any reusable function/class/type you add, rename, move or delete.
2. Schemas, API routes, shared types and env vars are contracts: change them in one place (`packages/shared`, migrations, `.env.example`, `DESIGN.md`) and say so in the commit.
3. Never hardcode a secret, and never fabricate a key, an endpoint response, or an LLM output outside the labeled fixtures.
4. Gemini calls: structured output only, temperature 0, cached, validated. Never use an LLM for arithmetic; amounts and splits are computed in code (`domain/split.ts`).
5. Money is integer cents internally; Nessie amounts are whole dollars at the boundary.
6. Keep the MVP cut line from `DESIGN.md` 1b. Do not build pgvector retrieval, web-search baselines, live sync, or social features beyond the stubs.
7. Mark anything stubbed for someone else `TODO(stub): <owner>`.
8. Commit only when asked, never push, keep diffs focused, don't reformat files you aren't changing.
9. If blocked on a human-only task (section 3), state exactly what is needed, work around it with the "until then" column, and report it in your final summary.
10. Final reports must say what was verified and what was not (for example: "pipeline matches truth in replay; live Gemini not run; no physical-device check").
