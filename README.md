# How Much Do Your Friends Cost?

A friend ledger: how much each friend has spent on you, how much you've spent on them, and who owes whom. Built from bank transactions (Nessie), messages and calendar, with Gemini doing the reading.

## Setup

```bash
pnpm install
cp .env.example .env    # then fill in keys
```

Works with no keys at all: local database, saved Gemini answers, demo data.

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
| Rebuild with real Gemini (costs a little, cached after) | `pnpm --filter server pipeline --llm live` |
| Regenerate demo data | `pnpm --filter server seed` |

## Keys (all optional)

| Key | Without it |
|---|---|
| `DATABASE_URL` | Local embedded database (`pglite://./.pgdata`) |
| `GEMINI_API_KEY` | Replays saved answers |
| `NESSIE_API_KEY` | Reads bank data from a local file |
| `LANGSMITH_API_KEY` + `LANGSMITH_TRACING=true` | No tracing |

## Good to know

- **Replay vs live.** `LLM_MODE=replay` never calls Gemini. Live answers are cached in the database, so each question is paid for once.
- **Shared database.** `pnpm demo` wipes and rebuilds the pipeline tables. On a shared Tiger Data database, that affects everyone.
- **Demo data** lives in `seed/scenario.json`; expected results in `seed/truth.json`.
- **More detail:** `DESIGN.md` (what and why), `BUILDPLAN.md` (how), `STRUCTURE.md` (where things are).
