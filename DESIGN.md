# How Much Do Your Friends Cost? — System Design (Stage 1)

Status: draft for team review. Design only, no implementation detail. Produced from the original brief plus a 5-advisor council review (see `docs/council-transcript-2026-10-24.md`).

## 1. What the product shows

One screen: a **friend ledger**. **The headline is how much each friend has spent on you.** What you've spent on them is tracked as the counterweight, to produce a balance.

```
              spent on you   you spent on them   balance
Sam              $212.00         $96.00         you owe Sam $116.00   ▸ Concert 4/02 · ...
Alex              $40.00        $283.00         Alex owes you $243.00 ▸ Uchi 3/12 · ...
Jordan            $60.00         $60.00         even
Possible (unconfirmed): $84 across 2 events (tap to confirm payer)
```

Sign convention in the stored balance: **positive = friend owes user, negative = user owes friend.** The UI always shows both gross figures next to the net.

When the user owes a friend, the debt leads and the card offers ways to pay it back through shared events (planned, recurring, or newly priced); see §15 and §16.

Consequence for the design: friend-paid events are the *primary* signal, not an edge case. The user's own Nessie rows are the cheap, reliable half; the friend-paid half rests on messages and needs the most care (sections 6c and 6d).

## 1b. MVP cut line (hackathon)

Everything below is the design; this is what ships first. Build in this order and stop when time runs out.

1. **Must (demo works):** seeded data in Postgres → events → Muse Spark attendee + payer extraction → directional ledger → friend list UI showing **spent on you** first, **you spent on them** second, then balance, with receipts. Both directions must be present in the seed data.
2. **Should:** assumed payer + "Possible" display + confirm flow (6d); Muse Spark repayment detection in messages; `unaccounted` bucket; confidence badge.
3. **Could:** calendar as a third source; review queue UI; eval script.
4. **Won't (MVP):** live API sync, per-day merge across all three sources (for MVP, join each transaction to the calendar/messages of the same day), friend-paid events without a stated amount.

## 2. Glossary

| Term | Meaning |
|---|---|
| Muse MCP | Long-term message source: an MCP server that exposes the user's messages and semantic search over them (MVP reads an Instagram export instead, §12). **Not the model**; the model is Muse Spark below. |
| Nessie | Capital One's sandbox banking API. Data is **synthetic**, so we seed it. |
| Tiger Data | Hosted Postgres (Timescale). Our only database. pgvector lives here. |
| Muse Spark | The one generation LLM, served by **Meta's Model API** (`muse-spark-1.3-contributor`, env `LLM_MODEL`). Always called with a structured-output schema (Chat Completions, `response_format: json_schema`) or, for web price lookups, the Responses API `web_search` tool. All LLM calls in this design mean Muse Spark. |
| Gemini (embeddings only) | Meta's Model API has no embedding model, so message embeddings (`EMBED_MODE=live`) stay on Gemini `gemini-embedding-001`. The default `EMBED_MODE=local` is an offline hashing embedder, so replay, eval and tests never contact Google. This is the only remaining Gemini use. |
| Proto event | A candidate event from one source (one calendar entry, one message cluster, one transaction cluster). Incomplete is fine; a date is required. |
| Event | One or more proto events merged. The unit that gets a debt calculation. |
| Ledger entry | One signed row: "for event E, person P owes/is owed $X, because Y". |

## 3. Design decisions (what changed from the brief, and why)

The council agreed on the first four points independently.

1. **Transaction-anchored debt, not "expected vs actual".** The original delta (expected cost from RAG/web, minus actual spend) subtracts one guess from another and presents it as fact. $60 on a $20 dinner could be generosity or a nice restaurant. Instead: debt comes from **who paid, how much, and who was there** (`amount / headcount`). The expected-cost baseline is demoted to a fallback (section 6, step 5).
2. **Merge steps 1 and 2.** Per-source proto events are still produced, but dedupe is a single Muse Spark pass per day, keyed on date. No cross-day fuzzy matching.
3. **Binary relevance rule, not a score matrix.** An event counts toward debt if it is social (≥2 people) and paid, and is backed by ≥2 sources. Everything else is stored but excluded.
4. **Batch, not live.** The pipeline runs offline, writes to Postgres, and the UI reads precomputed results. Meta API rate limits and latency never touch the demo.
5. **Seeded demo data is the demo.** Nessie is synthetic and won't line up with real messages. We build one curated dataset (3–5 friends, ~20 events) where the three sources agree, and design it to include a few messy cases on purpose.
6. **Keep:** the Event object, the "unaccounted debt" bucket (shown openly), and the "what is this transaction?" prompt (reframed as a *confirm* feature, not an error path).
7. **Defer:** pgvector for retrieval (Postgres full-text + date window is enough at demo scale; switch on if Muse MCP search proves unusable), SerpAPI/web-search baseline, ±30 min transaction windows (use same-day plus Muse Spark's judgment).

## 4. Pipeline

```
 Calendar API ─┐
 Muse messages ─┼─▶ 1. INGEST ─▶ 2. PROTO EVENTS ─▶ 3. MERGE (per day) ─▶ 4. RELEVANCE
 Nessie txns  ─┘     raw rows       per source          Muse Spark           binary rule
                                                                                │
                      7. UI ◀─ 6. LEDGER ◀─ 5. DEBT ATTRIBUTION ◀───────────────┘
                      net per      signed,        payer + amount + attendees
                      friend       netted         + repayment check
                                                  └─ unresolved ─▶ REVIEW QUEUE
```

## 5. Data model (Postgres on Tiger Data)

| Table | Key columns | Notes |
|---|---|---|
| `person` | id, display_name, is_user, `platform_user_id` (nullable) | One row per human. `platform_user_id` is a stub: set when this friend has joined the platform (see 11b). |
| `person_alias` | person_id, kind (phone / email / handle / merchant-name), value | **Identity resolution lives here.** Everything else references `person_id`. |
| `message` | id, thread_id, sender_id, sent_at, body, embedding (nullable) | All messages stored. Embedding column present but optional in v1. |
| `calendar_event` | id, title, description, start, end, attendee_ids | Raw copy. |
| `txn` | id, nessie_id, amount, merchant, occurred_at, payer_id | Raw copy. |
| `proto_event` | id, source (calendar/message/txn), source_ref, date, time?, description?, people_ids[] | Date required, rest nullable. |
| `event` | id, `owner_user_id`, `canonical_event_id` (nullable), date, time?, description, attendee_ids[], total_amount?, source_count, is_relevant, confidence, context_message_ids[] | Merged event. Deterministic id (hash of date + sorted attendees + anchor) so reruns are idempotent. **No payer column**: payers live in `event_payer` (an event can have several). |
| `canonical_event` (stub, unused in MVP) | id, date, merchant?, total_amount?, headcount?, member_event_ids[], confidence | The one real-world event that several users' private `event` rows all point at. See 11b. |
| `event_payer` | event_id, person_id, amount?, basis (confirmed / assumed / estimated), evidence_message_id?, txn_id? | One row per person who paid part of the bill. `confirmed` = Nessie txn or explicit message. `assumed` = best guess at who covered the user, awaiting confirmation. `estimated` = payer known, amount guessed. |
| `event_source` | event_id, proto_event_id | Provenance. |
| `ledger_entry` | id, event_id, payer_id, beneficiary_id, amount (≥0), kind (covered / repayment / unaccounted), basis (confirmed / assumed / estimated), evidence_message_id? | Directional: "payer spent `amount` on beneficiary". Source of truth. Per friend F: `spent_on_you` = covered rows F→user; `you_spent_on_them` = covered rows user→F; `balance = you_spent_on_them − spent_on_you`, adjusted by repayment rows. Only `confirmed` and `estimated` rows count toward balance; `assumed` rows show as "possible". |
| `review_item` | id, kind (alias / attendees / payer), txn_id / event_id, question, option_ids[], answer?, status | The "what is this?" queue. |
| `llm_cache` (implementation only) | key, model, prompt_id, response, created_at | LLM record/replay cache (model name is part of the key, so answers from one model are never served for another). Key = sha256(prompt id + version + model + canonical input). |

Implementation notes (Phase 0, authoritative DDL in `server/migrations/001_init.sql`, types in `packages/shared`):
- Money columns are integer cents: `txn.amount_cents`, `event.total_cents`, `event_payer.amount_cents`, `ledger_entry.amount_cents`.
- Ids are text (deterministic hashes for events). `txn` also stores `kind` (purchase / transfer), `merchant_category`, `description`; its date column is `occurred_on` (date only, Nessie has no time).
- `person_alias` has `status` (confirmed / candidate); a candidate has `person_id` null until resolved through the review queue.
- `proto_event.details` (jsonb) holds source-specific extras (payer hints, stated amounts, message ids, `looks_social`).
- `event.anchor_txn_id` records the Nessie transaction an event is anchored on (BUILDPLAN Phase 4 MVP simplification).
- `ledger_entry.event_id` is nullable (repayments not tied to one event); `beneficiary_id` is null only for `unaccounted`. Each row also carries `confidence` and `txn_id`.
- `DATABASE_URL` may be `pglite://<dir>` or `pglite://memory` (embedded Postgres) for zero-install dev and tests; the same migrations run on Tiger Data.

## 6. Steps

1. **Ingest.** Pull Calendar, Muse messages, Nessie transactions into raw tables. Resolve every name/phone/email/merchant string to a `person_id` via `person_alias`; unknown strings create a candidate alias for review.
2. **Proto events.**
   - *Messages:* group into conversations, Muse Spark reads 1-day windows, emits `{date, people, description, mentions_payment?}`. Later messages in the same thread attach to the same proto event.
   - *Calendar:* title + description + attendees map directly.
   - *Transactions:* merchant, amount, and nearby transactions (same merchant/day) suggest a group outing. Muse Spark gets merchant + amount + time and flags `looks_social`.
3. **Merge.** Per day, one Muse Spark call receives that day's proto events and returns merged groups. Merged `Event` carries description, people, date, time, payer, total, and `context_message_ids`. Output is schema-constrained and validated (every proto event assigned to exactly one event).
4. **Relevance.** `is_relevant = attendees ≥ 2 AND paid AND source_count ≥ 2`. Irrelevant events are stored, flagged, and excluded from the ledger. A transaction-only event with no similar past transaction goes to the **review queue** ("We see $84 at Uchi on 3/12. Who was there?"); the answer is written back and re-runs relevance.
5. **Debt attribution.**
   - *User paid:* `share = total / headcount`. For each other attendee, ledger entry `+share` (kind `covered`).
   - *Friend paid:* needs an amount. Take it from messages ("I got dinner, $120") if present; otherwise run `estimate_base_cost` (message → history search → RAG → web-search cold start, see 6c) and mark confidence low. Entry `-share` for the user.
   - *Repayments:* Muse Spark scans later messages in the thread for payments or settlements ("venmo'd you $20"). Each becomes a `repayment` entry that offsets the balance. Payments made outside Nessie (cash, Venmo) only show up this way.
   - *Remainder:* anything that cannot be explained lands in `unaccounted`. Never silently dropped.
6. **Ledger.** Recompute balances from `ledger_entry`. Idempotent: delete-and-rebuild entries for an event on rerun.
7. **UI.** Friend list with net balance, drill-down to events and the messages that justify each number, a confidence badge per entry, and the review queue.

## 6b. Transaction-anchored debt (user paid)

Debt is `(payer, beneficiaries, amount)`. Nessie gives payer and amount; the missing piece is who else was there.

1. Muse Spark marks the transaction `looks_social` (merchant, amount, time).
2. Pull same-day calendar events and messages as context.
3. Muse Spark returns `{attendees, split: "equal", confidence, evidence_message_ids}`.
4. `share = amount / headcount` (user included); each other attendee gets a ledger entry (payer = user, beneficiary = attendee, `share`).
5. Later "sent you $X" messages become `repayment` entries. Low confidence or unknown attendees go to the review queue.

Example: user paid $120 at Uchi, attendees user + Alex + Sam + Jordan → share $30 → three entries user→Alex/Sam/Jordan of $30. Alex later messages "sent you the $30" → repayment row Alex→user $30 → Alex's balance 0.

Weak spots: wrong headcount (mitigated by evidence links + confidence badge), uneven splits (equal assumed, stated in UI), cash/Venmo (visible only via messages).

## 6c. Covered-by-friend (user was covered, no user transaction)

Evidence here is testimony, not a Nessie row, so the anchor is a message or calendar event.

- **Explicit trigger (strong):** message like "I got this" / "thanks for covering me". Muse Spark extracts `{payer, amount?, attendees, evidence_message_id}`.
- **Implicit trigger (weak):** social event with ≥2 attendees and no user transaction near that time. Payer unknown.

Amount, in order (this is `estimate_base_cost`, the expected-cost step):
1. Stated in a message.
2. **History search:** the user's own past spend at the same merchant/event type, median in code (§14 adds a RAG step over past messages). Labeled `estimated`.
3. **Cold-start search:** if history finds nothing, a *separate* web search (Meta Responses API `web_search` tool) looks up a typical per-person cost of this merchant or event type, and Muse Spark turns the results into one number with a source link. Labeled `estimated`, confidence low. This is a distinct step so a missing history never blocks an estimate. Cache by merchant + event type.
4. `null` (event counted, no dollars).

MVP: step 3 is a stub (`TODO(stub): muse-cold-start`); the function returns null at step 3 and seeded data covers steps 1–2.

Debt: `share = total / headcount`; ledger entry payer = friend, beneficiary = user, `share` (this is the "spent on you" half). Multi-payer and assumed-payer handling: see 6d.

| Evidence | Counts in net balance? |
|---|---|
| Explicit, amount stated | yes |
| Explicit, amount estimated | yes, flagged "estimated" |
| Implicit | **no**; review queue ("Looks like someone covered you at Uchi 3/12. Who?") until confirmed |

Repayment by the user: Nessie transfer/purchase to the friend's alias, or a "sent you $X" message.

## 6d. Multiple payers and the assumed payer

An event can have several `event_payer` rows (friend A paid $60, friend B paid $40, user paid nothing).

**Split rule (equal split):** fair share = `total / headcount`. For each person, `surplus = paid − share`. Positive surplus = creditor, negative = debtor. Debtors owe creditors pro rata to creditor surplus. Each resulting pair becomes a directional `ledger_entry` (payer = creditor, beneficiary = debtor). Single-payer events fall out as the special case.

**User was covered but payer unknown:** we still make an assumption so the product has something to show.
1. Pick the most likely payer: Muse Spark names who was in the thread/calendar and said or implied "I got it"; otherwise the attendee most often the payer at past events with this group.
2. Write an `event_payer` row with `basis = assumed` and a `ledger_entry` with `basis = assumed`.
3. Show it as **Possible** in the UI and open a review item: "Did Sam cover you at Uchi?"
4. On confirmation (or correction to another friend) the row flips to `confirmed` with the actual payer and starts counting toward the balance. A different answer deletes the assumed rows and writes new ones, so the true payer always replaces the guess.

Friend-to-friend debts (payer and beneficiary both not the user) are ignored: we only track edges that touch the user.

MVP: auto-handle only explicit-with-amount; everything else goes to the review queue. Seed 2–3 such cases so the ledger runs both directions.

## 7. Evaluation

Hand-label the seeded dataset: for each event, true attendees, true payer, true split. After a pipeline run, report attendee accuracy and ledger-balance error per friend. This is the only way to claim the numbers are right, and it is cheap because we author the seed data.

## 8. Privacy

- Raw messages and calendar data stay in our database and are never shown beyond the receipts view for that friend.
- Demo uses seeded/fake or consenting people only.
- UI language is neutral ("balance", not "cost you").
- Say plainly in the UI: estimates are heuristic.
- **Contributor model:** `muse-spark-1.3-contributor` lets Meta train on prompts and completions. Fine for the synthetic seed data; set `LLM_MODEL=muse-spark-1.3` before running on any real messages. Embeddings (`EMBED_MODE=live` only) send message text to Google; the default local embedder sends nothing.
- LangSmith tracing is off by default. When `LANGSMITH_TRACING=true` and a key is set, traces send full prompt text (including message contents and names), model outputs and retrieval snippets to LangSmith. `LANGSMITH_HIDE_INPUTS=true` / `LANGSMITH_HIDE_OUTPUTS=true` send only structure, timing, token counts and metadata. Use with seeded/demo data only, not real user messages.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Muse MCP can't export or search as assumed | **Hour-1 spike.** If it cannot dump messages, fall back to a message JSON export / seeded messages. |
| LLM output varies run to run (Muse Spark occasionally omits a stated amount or files a per-person price as a total) | JSON-schema output, temperature 0, cache responses by input hash, code guards (a quoted amount must appear in the source text), ship precomputed results. |
| Wrong merges (lunch vs dinner same day) | Merge prompt sees times; keep proto-event provenance so a merge can be undone. |
| Identity resolution errors | Alias table + review queue for unknown strings. |
| Uneven splits, tips, tax, refunds | Out of scope v1; equal-split assumption stated in UI. |
| Meta API rate limits / cost | Batch job, cache, small seeded dataset. |

## 10. Work split (4 parallel streams)

A. Ingest adapters (Calendar, messages, Nessie) → raw tables + seed loader.
B. Muse Spark extraction + merge → `proto_event`, `event`.
C. Relevance, debt attribution, ledger → `ledger_entry`.
D. UI: friend ledger, drill-down, review queue.

**Hour 1, before anything else:** freeze the `event`, `ledger_entry`, and `person` schemas, record them in `STRUCTURE.md`, and run the Muse MCP spike.

## 11. Later (not v1)

pgvector retrieval over messages; expected-cost baseline via RAG and web search for friend-paid events with no stated amount; ±30 min transaction windows; reciprocity tracking ("next time's on me" promises, who's overdue); settle-up message drafts; multi-user shared ledger with opt-in.

## 11b. Future expansion: social (friends join the platform)

When friends join, the same dinner exists in several users' data. Link those copies into one **canonical event** and use the pooled evidence for the base cost. Today the amount for a covered-by-friend event is a guess (message, or the user's own history); with linked friends it can come from the payer's actual transaction or the attendees' combined view. Estimates of what you "owe" improve with every friend who joins.

How it works:
1. **Link.** Match events across users by date + merchant/venue + overlapping attendees (aliases resolve to `platform_user_id`). Write a shared `canonical_event`; each user's `event.canonical_event_id` points at it.
2. **Pool.** The canonical total comes from the best evidence available: the payer's own Nessie transaction (`confirmed`), else the median of attendees' reports. Each user's `event_payer` row for that event gets `basis = confirmed` or a new `crowd` value instead of `estimated`.
3. **Re-run.** Recompute the debt for every member copy; "Possible" rows flip to confirmed when the real payer is one of the platform's users.

Privacy, required before enabling: opt-in per user; share only derived fields (date, merchant, total, headcount, payer), never message text; a friend sees only the edge between themselves and you.

**Stubs to add now (cheap, nothing reads them in MVP):**
- `person.platform_user_id` (nullable)
- `event.owner_user_id` (a constant in MVP) and `event.canonical_event_id` (nullable)
- empty `canonical_event` table
- a single function `estimate_base_cost(event) -> (amount, basis)` that every caller uses for unknown amounts. MVP body: message-stated amount, else the user's own history, else null. Social later adds a `canonical_event` lookup at the top without touching callers.
- `basis` enum already includes room for `crowd`.

Mark each stub `TODO(stub): social` in code and list it in `STRUCTURE.md`.

## 12. Decisions on the open questions

1. **Messages: manual Instagram export for now.** Use Instagram's "Download your information" with messages only, JSON format. It arrives by email as a ZIP and can take hours to days, so request it early (or use a fake export in the same shape). The message adapter reads that JSON into `message`; Muse stays the long-term source. Keep the adapter behind one interface (`MessageSource`) so swapping to Muse later doesn't touch the pipeline. Needs: Instagram sender names → `person_alias` (display names, not phone numbers).
2. **Nessie: we can seed our own transactions.** Checked the [Nessie docs](https://nessieisreal.com/docs) (base URL `https://prod-api.nessieisreal.com`, auth by GitHub login to get a key, passed as `?key=`). Facts that affect the design:
   - Purchase fields: `_id`, `medium`, `transaction_date`, `status`, `amount` (integer), `description`, `merchant_id`. **No time of day** and **no counterparty or attendees**. So "same day" is the only matching we can do (the ±30 min window is impossible), and attendees must come from messages or calendar.
   - Merchants are a separate resource (name, category, location); `merchant_id` joins to it.
   - Transfers have the same shape (amount, date, description) and the page shows no payee field. Do not rely on transfers to identify a friend. Put the friend's name in `description` in the seed data, and parse it.
   - Accounts are created per customer (`POST /customers/{id}/accounts`), so seeding is: create customer → account → merchants → purchases. The per-account purchase list/create endpoints were not shown on the docs pages I read, so confirm them in the interactive docs before building the adapter.
   - `amount` is an integer, so whole-dollar amounts only.
3. **No real data.** The demo is fully synthetic: a seed script writes Nessie transactions and a fake Instagram-format message export for the same 3–5 invented friends. Both come from one source file, so the transactions, messages, and hand-labeled ground truth (section 7) agree by construction.

## 13. Implementation divergences (MVP build, 2026-10-24)

- Payer review "dismiss" = guess rejected: assumed rows removed, event drops out as irrelevant.
- A transaction-only event with a similar past purchase at the same merchant opens no review item and stays irrelevant.
- Repayments are stored with `event_id` null. A message repayment is dropped when a Nessie transfer with the same amount and parties exists within ±3 days (no double count).
- Answering a review item re-runs only that event (relevance → attribution → ledger); repayment detection is not recomputed until the next `--from attribution` run.
- `messageDay` prompt v2 adds `perPersonAmountDollars` ("$75 each") and `payers[]` (multi-payer bills); code multiplies, the LLM never does arithmetic.
- Live Nessie (checked 2026-10-24 with a real key; H6 resolved): `/accounts/{id}/purchases` and `/accounts/{id}/transfers` work for list and create. Merchant `category` is a string, not a list. Purchase create rejects `type`. Transfer create accepts only `transaction_date, status, amount, description` (no payee), and the list returns `id` instead of `_id` and answers 404 when empty. `NessieHttpClient` normalizes all of this. Ingest from live Nessie gives the same 15 transactions as the file source. Live txn ids differ from the file's, so replay fixtures only cover `NESSIE_SOURCE=file`.
- LLM provider (superseded 2026-10-25 by §17): the MVP originally ran on Gemini (`gemini-3.8-flash`); all generation now runs on Meta's Model API.
- Tiger Data: node-pg treats `sslmode=require` as verify-full and rejects Timescale's private CA; `createDb` applies libpq semantics (`uselibpqcompat=true`: encrypted, CA not verified), same as psql.

## 14. Retrieval and expected-cost baseline (added 2026-10-25, from §11)

- **pgvector retrieval.** New `embed` stage after ingest stores a 768-dim embedding per message (`message.embedding_vec`, HNSW cosine index; `message.embedding` real[] fallback where pgvector is absent; PGlite loads its vector extension). `EMBED_MODE=local` (default) uses a deterministic offline hashing embedder so replay never touches the network; `EMBED_MODE=live` uses Gemini embeddings (`GEMINI_EMBED_MODEL`, confirm in H3), the one place Gemini remains because Meta's Model API has no embedding model.
- **Expected-cost chain** for friend-paid events with no stated amount: stated → median of the user's past purchases at the merchant → **RAG**: semantic search over earlier messages, Muse Spark extracts stated prices (per-person, or total + headcount), code takes the median, same-venue quotes first, and keeps a quote only if that exact dollar amount appears in the retrieved message text → **web search**: Muse Spark with the Responses API `web_search` tool (free-text call, then structured extraction; the source URL always comes from the API's `url_citation` annotations and `web_search_call.results`, never from the model's text) → null. All results are `estimated`; the web step is low confidence.
- RAG evidence: `event_payer.evidence_message_id` points at the price message; the "on me" message stays in the event context.
- Without a merchant from the user's own transactions, the venue is the event description (also the web cache key).
- Seed adds two cases: Sam's karaoke (RAG finds "Ego's was like $20 a head") and Alex's kayak rental (web fixture, $25/person, hand-written replay).

## 15. Payback suggestions: settle a debt by doing something together (added 2026-10-25)

Status: design only. Builds on the ledger (§5), expected-cost chain (§14) and review flow; changes none of their contracts.

### 15.1 Idea and principle

If the user owes a friend money, the product should not only show the number. It should say **"you owe Sam $116. Here are ways to pay it back"**, using events the two of them already have coming up, events they tend to do together, or new ideas priced from the web. Treating Sam to an outing is a payback in kind: it creates a user-paid event where Sam's share lands in the ledger as `you_spent_on_them` and shrinks the balance by the normal §6b/§6d rules. No new accounting is introduced.

**Lead with the debt.** The suggestion is always attached to a debt and shown under it, never as a free-floating "things to do" feed. A friend with no debt owed by the user gets no suggestions. The debt amount, its gross figures and its "possible" caveat (§1) are the first thing on the card; the options are the answer to it.

```
┌ You owe Sam $116.00 ───────────────── (gross: Sam spent $212 on you, you spent $96) ┐
│  Ways to pay it back                                                                 │
│  ● Covers $118 (est.)  Fri 11/01 Concert with Sam        planned · on your calendar  │
│  ● Covers $112 (est.)  Thai Tuesday ($34) + Climbing ($78)   recurring + new idea    │
│  ○ Partial $60 (est.)  Uchi dinner, 2 people              you've done this 4 times   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Scope: only debts **the user owes** (balance < 0). Friends who owe the user are untouched (no nudging friends, see §8). Only `confirmed` and `estimated` balance counts; `assumed` ("possible") money is never used as the target.

### 15.2 Value of an option = the friend's share, not the bill

The user picks up the check for an outing with headcount N and per-person cost `c`. The friend's share is `c`, and that is what reduces the debt (their own share is the user's own spending on themselves, §6d). So:

`payback_value = friend_share = total / headcount`, computed with `domain/split.ts` using a hypothetical "user paid" event, not with ad-hoc math. Large-group options count only the target friend's slice. All amounts are integer cents; the LLM never does arithmetic (BUILDPLAN rule 4).

Every option carries a **range** `[low, high]` and a `basis` reusing the `Basis` vocabulary where possible (`estimated`), because the whole feature rests on cost guesses.

### 15.3 Three candidate sources, two tiers

**Priority.** Doing something *new* with a friend beats repeating what you already know you do. So there are two tiers:
1. **Top tier, equal priority: A (planned) and C (discovered).** Planned events are things already happening; discovered ideas are new things to try. Both are things to look forward to, and they compete on price fit, not on source.
2. **Fallback tier: B (recurring).** The user already knows about these. They fill a bundle when the top tier cannot reach the debt, and never displace a new idea of the same price.

In the scoring (§15.4) this is the `trust` term: planned 1.0, discovered 0.9, recurring at most 0.5 × regularity. Discovered is not set equal to planned because its *price* is shakier; that is already charged by the separate price-confidence term and must not be charged twice.

**A. Upcoming shared events (planned).** Future events involving the user and the target friend, from:
- *Calendar:* `calendar_event` with `start > asOf` and the friend in `attendee_ids` (alias-resolved, §5). A price written as "$59 each" in the title or description is the stated per-person cost.
- *Messages:* the `planFinder` prompt (Muse Spark) reads recent chats (the last 30 days, one call per thread that has a debtor as a sender) and returns concrete future plans `{date, time?, description, venue?, peopleIds[], perPersonAmountDollars?, payerId?, sourceMessageIds[]}`. Relative dates ("Friday") are resolved against each message's date and weekday, which the prompt supplies. Vague ideas ("we should go sometime"), past-tense mentions and plans with no concrete date are not plans.

**Code, not the model, decides what a chat plan is worth** (`domain/plans.ts`). A proposed plan is rejected when: its date is not a real calendar date (`2026-02-30`), is not after `asOf`, or is more than 180 days out; it cites no message that was in the prompt; it has no known friend in it; or a **friend is paying** (`payerId` is not the user), because that adds to the debt instead of reducing it. Dollars become cents in code; the model never does arithmetic.

**One plan, one candidate.** A calendar entry and a chat mention on the same day with a friend in common are the same plan (`mergePlans`). The calendar entry wins as the user's own record; a price only the chat states is carried over, and both receipts are kept.

**B. Recurring past events (predicted), the fallback tier.** From the user's own relevant past events with that friend (`event.is_relevant`, ≥2 attendees):
1. Normalize each past event to an **activity key**: merchant if known, else a Muse Spark-normalized label (e.g. `"thai lunch"`, `"climbing gym"`), cached.
2. Group by `(friend, activity key)`. Require ≥3 occurrences.
3. Compute cadence in code: median gap in days, weekday mode, gap dispersion. `regularity = 1 − (MAD_gap / median_gap)`, clamped to [0,1].
4. Predict `next_date` by rolling `last_date` forward in whole median gaps until it is after `asOf` (snapped to the weekday mode when ≥60% of occurrences share one). A pattern idle for more than 4 gaps has lapsed and is dropped. Skip a prediction already covered by a planned event from A at the same place within ±3 days.
5. Cost = `estimateBaseCost` chain (§14), history first, so it is usually the user's own median.

This part is deterministic code over `event` rows. The LLM only normalizes labels.

**C. New recommendations (discovered), top tier.** Derive what this pair likes, then price real options with **SerpAPI**. Ideas must be *new to the pair*: a result is dropped if it matches (substring, either direction, on normalised text) an activity the pair has already done with each other or anything already planned (`isNovel`). The novelty filter runs before the per-query cut, so a place they already know does not use up a slot. Per friend: the top 3 novel results per query, interleaved across queries and capped at 6 overall, so one query cannot crowd out the others. The solver needs a spread of prices to hit a dollar target, so one result per friend is too few; but about 3 SerpAPI calls per debtor per run is the real cost, not the result count.
1. *Interests:* Muse Spark over messages retrieved by pgvector (§14) for the pair returns `{interests: [{label, category, evidence_message_ids[]}]}` (e.g. "mini golf", "ramen", "live comedy", "Radiohead"). Plus categories from the recurring patterns in B.
2. *Search:* per interest, one SerpAPI query by category:
   - events/concerts/shows → `google_events` (date, venue, ticket info)
   - restaurants/bars/activities → `google_maps` / `google_local` (price level, rating, price range text)
3. *Price:* Muse Spark turns the SerpAPI result JSON into `{perPersonLowCents, perPersonHighCents, venue, url, date?}` with structured output. The source URL always comes from the SerpAPI response, never from the model (same rule as §14). Price level only ("$$") maps to a fixed, documented band table in code, flagged low confidence.
4. Results are cached by `(engine, normalized query, location, day)` with a TTL, and counted against a per-run call budget (`SERPAPI_MAX_CALLS`).

This replaces the Muse `web_search` call as the source for **new-idea pricing** only. §14's `web_search` step stays as the cold-start fallback inside `estimateBaseCost`; the two share the cached price-extraction schema so there is one place that turns "web result" into cents.

### 15.4 Combination solver

Given debt `D` and a candidate set, find the best bundle that approximately settles `D`.

- **Target and tolerance:** `|sum(bundle) − D| ≤ max($10, 10% of D)`. Landing slightly under is preferred to over (the user should not overpay a friend by much). Tolerance is config. Ranges are used: a bundle qualifies when `D` falls within its summed `[low, high]` widened by the tolerance.
- **Search:** at most 3 options per bundle, candidates pruned to the top ~25 by score. Exhaustive subset search over that set is trivial; use a subset-sum with cent buckets, no solver dependency. No two options on the same date/time unless the calendar says they don't overlap; no duplicate activity key in one bundle.
- **Score:** weighted sum, higher is better:
  `0.50 × closeness` + `0.25 × mean(trust)` + `0.15 × mean(soonness)` + `0.10 × min(price confidence)` − `0.03 × (items − 1)`. Closeness is the distance from the debt to the bundle's price range (overshoot counts double). `trust` is the two-tier priority of §15.3: planned 1.0, discovered 0.9, recurring ≤ 0.5 × regularity. Soonness decays to zero over 120 days (undated ideas score 0.5).
- **Fallbacks:** if no bundle is within tolerance, return the best **partial** bundle ("covers about $60 of $116") and say so. If the debt is below the cheapest option, offer "settle with a Nessie transfer / message" as the default non-event option so the card is never empty.
- Pure function in `domain/payback.ts`, table-tested like `split.ts`, with rounding cases and ties broken by option id for determinism.

### 15.5 Data model additions

New tables only; no existing column changes. Authoritative DDL goes in `server/migrations/003_payback.sql` when built.

| Table | Key columns | Notes |
|---|---|---|
| `future_event` | id, owner_user_id, friend_ids[], date, time?, description, venue?, source (calendar / message), source_refs[], payer_hint?, stated_cost_cents?, confidence | Planned events. Kept apart from `event`, which is past and ledger-bearing, so a plan can never leak into balances. |
| `recurring_pattern` | id, friend_id, activity_key, occurrences, last_date, median_gap_days, weekday?, regularity, member_event_ids[], next_date_pred | Recomputed idempotently per friend. |
| `interest` | id, friend_id (or pair), label, category, evidence_message_ids[], created_at | Output of the interest pass; used only to make search queries. |
| `price_quote` | key, engine, query, location, response, per_person_low_cents, per_person_high_cents, url, fetched_at | SerpAPI cache and shared price-extraction output. |
| `payback_candidate` | id, friend_id, kind (planned / recurring / discovered), ref_id, title, date?, per_person_low_cents, per_person_high_cents, headcount, friend_share_low_cents, friend_share_high_cents, basis, confidence, evidence_json | One priced option. Rebuilt from sources each run. |
| `payback_suggestion` | id, friend_id, debt_cents, candidate_ids[], total_low_cents, total_high_cents, kind (exact / partial / fallback), score, computed_at | The solver's output; the app reads this. |

`future_event` and `recurring_pattern` are derived and rebuildable; `price_quote` is a cache. Nothing here is a source of truth for debt, which stays `ledger_entry`.

### 15.6 API and UI

New routes (DTOs in `packages/shared`, cents on the wire; these are new contracts, coordinate before freezing):

| Method and path | Returns |
|---|---|
| `GET /friends/:id/payback` | `{ debtCents, toleranceCents, suggestions: [{ id, kind, totalLowCents, totalHighCents, items: [{ title, date?, source, friendShareLowCents, friendShareHighCents, basis, confidence, url?, evidence }] }] }`. Empty when the user owes nothing. |
| `GET /friends` | existing row gains optional `paybackAvailable: boolean` so the Friends list can lead with "You owe Sam $116 · 3 ways to settle". |
| `POST /payback/:id/dismiss` | hides a suggestion (stored per friend + candidate ref). |

UI: the Friends card keeps the debt as headline (§1); a "Ways to pay it back" section on the card or detail screen lists suggestions, each with a "why" expander showing the receipts that justify it (the calendar entry, the past dates, the web price source). Copy stays neutral and framed as ideas, never as pressure. Source labels follow the two tiers: `planned` → "planned", `discovered` → "new idea", `recurring` → "tried and true" (the server's receipt text for recurring options already opens with "A tried-and-true one"; discovered ones with "Something new to try together"). The heuristic disclaimer from §8 applies, plus "prices are estimates".

### 15.7 Privacy, safety, cost

- SerpAPI receives only a venue/category/city query. No message text, names or amounts leave the system for it. Muse Spark sees messages exactly as it does elsewhere (§8, including the contributor-model note).
- Interest extraction stays within the pair's own threads; it never surfaces a friend's private interests the user could not already see in the user's own messages.
- Needs a `HOME_CITY` setting for location queries.
- SerpAPI is paid per search: batch only, cache, per-run budget, and replay mode returns fixtures with no network (same `LLM_MODE=replay` discipline).

### 15.8 Risks

| Risk | Mitigation |
|---|---|
| Price guesses make the "sums to the debt" claim look more exact than it is | Show ranges and "est."; tolerance band is visible; partial bundles are labeled as partial |
| Message plans misread (past tense, hypotheticals, "we should sometime") | Prompt requires a concrete date or weekday; drop `"someday"` plans; show evidence |
| Recurrence from too little data | Min 3 occurrences, regularity floor, labeled "usually" not "will" |
| Suggesting an event the friend is paying for | Exclude events with a friend `event_payer` hint |
| Suggestions read as a nag or a transaction pitch | Only for debts the user owes, user-facing only, dismissible |
| SerpAPI quota or schema drift | Cache, budget, one adapter file, replay fixtures |

## 16. System design: payback suggestions

### 16.1 Architecture

```
                     ┌──────────────────────── existing pipeline (§4) ────────────────────────┐
 Calendar ─┐         │ ingest → embed → proto → merge → relevance → attribution → ledger_entry │
 Messages ─┼─────────┤                                                              │          │
 Nessie  ──┘         └──────────────────────────────────────────────────────────────┼──────────┘
     │                                                                               ▼
     │   ┌──────────────────────── payback stages (new, batch) ─────────────────────────────┐
     │   │                                                                                  │
     │   │  [P0 debts]  friendTotals() → friends where balance < 0   ◀── ledger_entry       │
     │   │       │                                                                          │
     │   │       ├─▶ [P1 plans]     calendar(start>asOf) + chat (planFinder) ─▶ future_event │  top
     │   │       ├─▶ [P3 discover]  merchant categories → SerpAPI ─▶ price_quote           │  tier
     │   │       │                  (google_events / google_maps), novel to the pair only  │
     │   │       └─▶ [P2 patterns]  past relevant events → activity keys ─▶ recurring_pattern │ fallback
     │   │                                                                                  │
     │   │  [P4 price]   estimateBaseCost (stated → history → RAG → web) ─▶ friend_share ranges
     │   │       │                           └ uses split.ts for the "user paid" hypothetical│
     │   │       ▼                                                                          │
     │   │  payback_candidate ─▶ [P5 solve] domain/payback.ts ─▶ payback_suggestion         │
     │   └──────────────────────────────────────────────────────────────────────────────────┘
     │                                                              │
     │                          Fastify API  GET /friends/:id/payback, GET /friends
     │                                                              │
     └───────────────────────────────────────────────────────────▶ App: debt card → "Ways to pay it back"
```

The payback stages are a second leg of the same batch run (`--from payback` runs P0–P5 only). They only read the ledger and write their own tables, so a failure here cannot change a balance.

### 16.2 Components

| Component | Responsibility | Type | Notes |
|---|---|---|---|
| `pipeline/payback.ts` | The stage (`runPayback`) and the read path (`solveFriend`, `dismissSuggestion`): debts, plans, patterns, discovery, pricing, persistence | code | One file, P0–P5; uses `domain/balance.ts` (excludes `assumed`) and `splitEvent` for friend shares |
| `llm/prompts/planFinder.ts` + `llm/schemas/planFinder.ts` | Plans from chat | Muse Spark | The only LLM call in this feature today; fixture key `<asOf>__<thread>` |
| `domain/plans.ts` | Accept/reject chat plans; merge calendar + chat duplicates | **pure** | Dates, horizon, friend-paying, cited sources; the model proposes, code decides |
| `domain/recurrence.ts` | Cadence, regularity, next-date prediction | **pure** | Table-tested |
| `domain/payback.ts` | Bundle search, scoring, tolerance, fallbacks; `TRUST` tiers; `isNovel` | **pure** | The only place that combines options |
| `domain/serpPrice.ts` | Priced places out of SerpAPI JSON; price-level bands; "Nov 7" → date | **pure** | No network, no LLM |
| `sources/serpapi.ts` | `SerpApiClient` (`replayClient`, `liveClient`), `cachedSerp` (per-day cache in `price_quote`, call budget) | adapter | One file for all SerpAPI paths and params; human task H13 for the key |
| `api/app.ts`, `db/queries.ts` | `GET /friends/:id/payback`, `POST /payback/:id/dismiss`, `paybackCount` on `/friends` | code | DTOs in `packages/shared` |
| `interests` (not built) | Pair interests from retrieved messages → better SerpAPI queries | Muse Spark | `TODO(stub): interests-llm`; today queries come from merchant categories |
| App: `PaybackSection` (not built) | Render debt-led card and options with receipts | UI | Frontend owner |

LLM calls follow the existing rules: structured output only, temperature 0, cached, zod-validated, replay fixtures for tests. Prompt ids built: `planFinder`. Not built: `activityLabel`, `interests`; `serpPrice` was replaced by deterministic extraction (`domain/serpPrice.ts`), which is safer because SerpAPI returns structured fields.

### 16.3 Request path (what the user sees)

```
App opens Friends ──▶ GET /friends ──▶ row: "You owe Sam $116 · 3 ways to settle"
Tap card ───────────▶ GET /friends/sam/payback
                       └─ reads payback_suggestion + candidates + evidence (precomputed, no LLM, no SerpAPI)
User dismisses ─────▶ POST /payback/:id/dismiss ──▶ stored; solver excludes it next run
User answers a review item (balance changes) ──▶ existing re-run (§13) ──▶ stale flag set
                       └─ the solver (pure, fast) re-runs for that friend on next read; no external calls
```

The read path never calls Meta's API or SerpAPI. Only the solver (pure) may re-run on demand, because a balance change moves `D` but not the candidate prices.

### 16.4 Key sequences

**Batch (nightly or `pnpm pipeline --from payback`):**
1. P0 selects debtors. If none, stop.
2. For each debtor, in parallel with `mapLimit`: P1, P2, P3 produce raw candidates.
3. P4 prices all candidates through one function so every option is `friend_share = f(total, headcount)` with the same rounding.
4. P5 writes ranked suggestions. Idempotent: delete-and-rebuild the friend's candidates and suggestions.

**Worked example (seed-style):** Sam is owed $116 (debt `D = $116`, tolerance `$11.60`).
- Planned: Concert 11/01 on the calendar with Sam; ticket posted at $59/person → friend share $59.
- Recurring: "Thai lunch" every ~14 days, 4 occurrences, median cost $17/person → share $17.
- Discovered: Climbing gym day pass via SerpAPI, $28–$32/person.
- Solver: {Concert 59 + Thai 17 + Climbing 30} = $106 (within $11.60 of $116) and {Concert 59 + Dinner 57} = $116 exact. Output both, best first, each with its evidence.

### 16.5 Config and env (new contracts; add to `.env.example`, covered by the existing env guard test)

LLM settings already exist (§17): `META_API_KEY`, `META_BASE_URL`, `LLM_MODEL`, `LLM_REASONING`, `LLM_MODE`. The payback prompts use them unchanged; only the SerpAPI and payback settings below are new.

```
AS_OF_DATE=2026-10-25            # demo clock; calendar entries after it are plans. Unset = today
SERPAPI_API_KEY=                 # human task H13
SERPAPI_MODE=replay              # live | replay  (replay reads server/test/fixtures/serpapi/, never the network)
SERPAPI_MAX_CALLS=20             # per pipeline run
HOME_CITY=Austin, Texas          # location for event/place queries
PAYBACK_TOLERANCE_PCT=10
PAYBACK_TOLERANCE_MIN_CENTS=1000
PAYBACK_MAX_BUNDLE=3
```

New human-only task for `BUILDPLAN.md` §3: **H13 SerpAPI key** (account signup, free tier is small; confirm `google_events` and `google_maps` engine params in their playground). Until then: build `SerpApiClient` against the file/replay implementation and hand-written fixtures.

### 16.6 Build order and MVP cut

1. **Must (built):** `domain/payback.ts` solver with tests; candidates from **seeded** planned events and recurring patterns; API route. Truth check: seeded suggestions sum within tolerance of the seeded debt. **Not built:** the debt-led card in the app (frontend owner).
2. **Should (built):** message `planFinder` with calendar/chat dedupe; SerpAPI discovery with replay fixtures; novelty rule and per-friend cap; receipts text on every option (the evidence expander is UI, not built).
3. **Could (partly built):** dismiss flow (built); partial/fallback bundles (built). **Not built:** live SerpAPI (untested, needs the key), interest extraction from pgvector.
4. **Won't (MVP):** booking or ticket purchase, payments, suggestions for friends who owe the user, group-level (3+ people) optimization, learning from accepted suggestions.

Stubs follow the repo convention: anything depending on another owner is marked `TODO(stub): <owner>` (for example the live SerpAPI client `TODO(stub): serpapi-live`). `STRUCTURE.md` gets a "Payback" section when code lands.

### 16.7 Evaluation

Extend the §7 hand-labeled dataset: for each debtor, the expected candidate set (planned, recurring) and the expected best bundle(s). Report: recurrence precision (predicted next date within ±3 days of truth), pricing error against seed prices, and bundle correctness (every returned bundle within tolerance of the debt, no excluded event types such as friend-paid). Replay mode must reproduce results exactly.

### 16.8 Open questions

1. Is overshooting acceptable (user pays back more than owed, creating a reverse debt)? Default: allowed up to the tolerance, never beyond.
2. Should the user be able to say which friends are "payback-eligible" or set a budget cap per option? Default: no, dismiss only.
3. Home city source: config for MVP, calendar location or message mentions later.
4. Does the target friend's consent matter? The feature is user-facing only and sends nothing to the friend; any "propose this plan to Sam" action is out of scope and would need a separate design.

## 17. LLM provider: Meta Model API (Muse Spark), from `MIGRATION.md` (2026-10-25)

All LLM generation runs on Meta's Model API with `muse-spark-1.3-contributor`. This section is the design-level summary; `MIGRATION.md` has the code detail. The one exception is message embeddings, which stay on Gemini because Meta has no embedding model (§2, §14).

**Two call shapes, one adapter file (`server/src/llm/muse.ts`, the only code that knows the wire format):**

| Need | API | Notes |
|---|---|---|
| Structured extraction (every prompt in §6, §14, §15) | Chat Completions `POST /v1/chat/completions`, `response_format: json_schema`, `strict: false`, `temperature: 0` | Meta's strict mode requires every property in `required`; our zod schemas have optional fields, so strict returns HTTP 400. Output is still schema-constrained and validated by zod, with one repair retry. Refusal, truncation (`finish_reason: "length"`) and empty content fail loudly. |
| Web price lookup (cold start, §6c/§14) | Responses API `POST /v1/responses`, `tools: [{type: "web_search"}]`, then a second structured call | Muse interleaves `phase: "commentary"` progress messages; only the non-commentary message is the answer. Source URLs come from `url_citation` annotations, then `web_search_call.results` (deduped, capped at 10), never from model text. |

**Config (contract):** `META_API_KEY` (required for `LLM_MODE=live`), `META_BASE_URL` (default `https://api.meta.ai/v1`), `LLM_MODEL` (default `muse-spark-1.3-contributor`), `LLM_REASONING` (`default|minimal|low|medium|high|xhigh`, default `low`; `none` returns HTTP 400 and `max` is unavailable on contributor models, so neither is allowed). `GEMINI_MODEL` and `GEMINI_THINKING` are removed; `GEMINI_API_KEY` and `GEMINI_EMBED_MODEL` remain for `EMBED_MODE=live` only.

**What does not change:** the cache → replay fixture → live path, temperature 0, zod validation, "the LLM never does arithmetic", the two-call web-search design, schemas, API routes and DB tables. `llm_cache` keys include the model name, so old Gemini-era entries are never served as Muse answers; replay fixtures are looked up by readable key and still apply.

**Model-specific safeguards (found by the live eval):**
- Muse Spark at `low` reasoning sometimes computes a number (`$20 × 3 = $60`) or files a per-person price as a total. The RAG step therefore keeps a quoted figure only if that exact dollar amount appears in the retrieved message, and moves a headcount-less total that the text writes per-person ("$20 a head") to `perPersonDollars`. `costFromSnippets` prompt is v2.
- It also occasionally drops a stated amount (about 1 to 2 runs in 10). An unknown amount is never guessed; it lands in `unaccounted` (§6, step 5).

**Impact on §15/§16:** the four new prompts (`planFinder`, `activityLabel`, `interests`, `serpPrice`) are ordinary Muse Spark structured calls through the same client, so they inherit the guards above. Prompts that return prices must also keep every figure verifiable against the source text or SerpAPI result before code uses it. SerpAPI remains the source for **new-idea** pricing (§15.3 C); Muse `web_search` stays only as the cold-start fallback in `estimateBaseCost`.

**Privacy:** the contributor model gives Meta prompts and completions for training (§8). Use it with synthetic data only; switch `LLM_MODEL=muse-spark-1.3` before real messages.

**Live verification so far (from `MIGRATION.md`, on the migration branch, not re-run here):** replay eval 22/22 events with exact friend totals; live eval 22/22 events and attendees, 19/22 payers. Remaining live misses are the kayak price (live web says about $20, the seed fixture says $25) and two intermittent omissions.
