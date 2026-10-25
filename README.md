# How Much Do Your Friends Cost?

A friend ledger: how much each friend has spent on you, how much you've spent on them, and who owes whom. Built from bank transactions (Nessie), messages and calendar, with Meta's Muse Spark 1.3 model doing the reading.

## Setup

```bash
pnpm install
cp .env.example .env    # then fill in keys
```

Works with no keys at all: local database, saved model answers, demo data.

## Run it

```bash
pnpm demo                    # rebuild everything from demo data, start the API on :3000
pnpm --filter app web        # app in the browser
pnpm --filter app start      # app on your phone (scan the QR code with Expo Go)
```

Already built and just want the API? `pnpm --filter server dev` (seconds, no rebuild).

## Common commands

| What | Command |
|---|---|
| Tests | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Check results against expected totals | `pnpm --filter server eval` |
| Rebuild with the real model (costs a little, cached after) | `pnpm --filter server pipeline --llm live` |
| Live smoke test (structured output + web search) | `pnpm --filter server exec tsx src/cli/llm-smoke.ts` |
| Regenerate demo data | `pnpm --filter server seed` |

## Keys (all optional)

| Key | Without it |
|---|---|
| `DATABASE_URL` | Local embedded database (`pglite://./.pgdata`) |
| `META_API_KEY` | Replays saved answers (live LLM calls need it) |
| `GEMINI_API_KEY` | Embeddings only, for `EMBED_MODE=live`; default `local` needs no key |
| `NESSIE_API_KEY` | Reads bank data from a local file |
| `LANGSMITH_API_KEY` + `LANGSMITH_TRACING=true` | No tracing |

## Good to know

- **Replay vs live.** `LLM_MODE=replay` never calls the model. Live answers are cached in the database, so each question is paid for once.
- **Model.** `LLM_MODEL` defaults to `muse-spark-1.3-contributor` (cheaper; Meta trains on prompts and answers). Set `LLM_MODEL=muse-spark-1.3` for the standard model. Old `.env` files: `GEMINI_MODEL` and `GEMINI_THINKING` are no longer read; use `LLM_MODEL` and `LLM_REASONING` (see `.env.example` and `MIGRATION.md`).
- **Shared database.** `pnpm demo` wipes and rebuilds the pipeline tables. On a shared Tiger Data database, that affects everyone.
- **Demo data** lives in `seed/scenario.json`; expected results in `seed/truth.json`.
- **More detail:** `DESIGN.md` (what and why), `BUILDPLAN.md` (how), `STRUCTURE.md` (where things are).
