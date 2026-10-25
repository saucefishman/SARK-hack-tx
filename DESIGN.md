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

Consequence for the design: friend-paid events are the *primary* signal, not an edge case. The user's own Nessie rows are the cheap, reliable half; the friend-paid half rests on messages and needs the most care (sections 6c and 6d).

## 1b. MVP cut line (hackathon)

Everything below is the design; this is what ships first. Build in this order and stop when time runs out.

1. **Must (demo works):** seeded data in Postgres → events → Gemini attendee + payer extraction → directional ledger → friend list UI showing **spent on you** first, **you spent on them** second, then balance, with receipts. Both directions must be present in the seed data.
2. **Should:** assumed payer + "Possible" display + confirm flow (6d); Gemini repayment detection in messages; `unaccounted` bucket; confidence badge.
3. **Could:** calendar as a third source; review queue UI; eval script.
4. **Won't (MVP):** live API sync, pgvector, web-search baselines, per-day merge across all three sources (for MVP, join each transaction to the calendar/messages of the same day), friend-paid events without a stated amount.

## 2. Glossary

| Term | Meaning |
|---|---|
| Muse | Message source. MCP server that exposes the user's messages and semantic search over them. Web search is a separate tool, used only as a fallback. |
| Nessie | Capital One's sandbox banking API. Data is **synthetic**, so we seed it. |
| Tiger Data | Hosted Postgres (Timescale). Our only database. pgvector lives here. |
| Gemini | The one LLM. Always called with a structured-output schema. |
| Proto event | A candidate event from one source (one calendar entry, one message cluster, one transaction cluster). Incomplete is fine; a date is required. |
| Event | One or more proto events merged. The unit that gets a debt calculation. |
| Ledger entry | One signed row: "for event E, person P owes/is owed $X, because Y". |

## 3. Design decisions (what changed from the brief, and why)

The council agreed on the first four points independently.

1. **Transaction-anchored debt, not "expected vs actual".** The original delta (expected cost from RAG/web, minus actual spend) subtracts one guess from another and presents it as fact. $60 on a $20 dinner could be generosity or a nice restaurant. Instead: debt comes from **who paid, how much, and who was there** (`amount / headcount`). The expected-cost baseline is demoted to a fallback (section 6, step 5).
2. **Merge steps 1 and 2.** Per-source proto events are still produced, but dedupe is a single Gemini pass per day, keyed on date. No cross-day fuzzy matching.
3. **Binary relevance rule, not a score matrix.** An event counts toward debt if it is social (≥2 people) and paid, and is backed by ≥2 sources. Everything else is stored but excluded.
4. **Batch, not live.** The pipeline runs offline, writes to Postgres, and the UI reads precomputed results. Gemini rate limits and latency never touch the demo.
5. **Seeded demo data is the demo.** Nessie is synthetic and won't line up with real messages. We build one curated dataset (3–5 friends, ~20 events) where the three sources agree, and design it to include a few messy cases on purpose.
6. **Keep:** the Event object, the "unaccounted debt" bucket (shown openly), and the "what is this transaction?" prompt (reframed as a *confirm* feature, not an error path).
7. **Defer:** pgvector for retrieval (Postgres full-text + date window is enough at demo scale; switch on if Muse search proves unusable), SerpAPI/web-search baseline, ±30 min transaction windows (use same-day plus Gemini's judgment).

## 4. Pipeline

```
 Calendar API ─┐
 Muse messages ─┼─▶ 1. INGEST ─▶ 2. PROTO EVENTS ─▶ 3. MERGE (per day) ─▶ 4. RELEVANCE
 Nessie txns  ─┘     raw rows       per source          Gemini               binary rule
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
| `llm_cache` (implementation only) | key, model, prompt_id, response, created_at | Gemini record/replay cache. Key = sha256(prompt id + version + model + canonical input). |

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
   - *Messages:* group into conversations, Gemini reads 1-day windows, emits `{date, people, description, mentions_payment?}`. Later messages in the same thread attach to the same proto event.
   - *Calendar:* title + description + attendees map directly.
   - *Transactions:* merchant, amount, and nearby transactions (same merchant/day) suggest a group outing. Gemini gets merchant + amount + time and flags `looks_social`.
3. **Merge.** Per day, one Gemini call receives that day's proto events and returns merged groups. Merged `Event` carries description, people, date, time, payer, total, and `context_message_ids`. Output is schema-constrained and validated (every proto event assigned to exactly one event).
4. **Relevance.** `is_relevant = attendees ≥ 2 AND paid AND source_count ≥ 2`. Irrelevant events are stored, flagged, and excluded from the ledger. A transaction-only event with no similar past transaction goes to the **review queue** ("We see $84 at Uchi on 3/12. Who was there?"); the answer is written back and re-runs relevance.
5. **Debt attribution.**
   - *User paid:* `share = total / headcount`. For each other attendee, ledger entry `+share` (kind `covered`).
   - *Friend paid:* needs an amount. Take it from messages ("I got dinner, $120") if present; otherwise run `estimate_base_cost` (message → history search → Muse cold-start web search, see 6c) and mark confidence low. Entry `-share` for the user.
   - *Repayments:* Gemini scans later messages in the thread for payments or settlements ("venmo'd you $20"). Each becomes a `repayment` entry that offsets the balance. Payments made outside Nessie (cash, Venmo) only show up this way.
   - *Remainder:* anything that cannot be explained lands in `unaccounted`. Never silently dropped.
6. **Ledger.** Recompute balances from `ledger_entry`. Idempotent: delete-and-rebuild entries for an event on rerun.
7. **UI.** Friend list with net balance, drill-down to events and the messages that justify each number, a confidence badge per entry, and the review queue.

## 6b. Transaction-anchored debt (user paid)

Debt is `(payer, beneficiaries, amount)`. Nessie gives payer and amount; the missing piece is who else was there.

1. Gemini marks the transaction `looks_social` (merchant, amount, time).
2. Pull same-day calendar events and messages as context.
3. Gemini returns `{attendees, split: "equal", confidence, evidence_message_ids}`.
4. `share = amount / headcount` (user included); each other attendee gets a ledger entry (payer = user, beneficiary = attendee, `share`).
5. Later "sent you $X" messages become `repayment` entries. Low confidence or unknown attendees go to the review queue.

Example: user paid $120 at Uchi, attendees user + Alex + Sam + Jordan → share $30 → three entries user→Alex/Sam/Jordan of $30. Alex later messages "sent you the $30" → repayment row Alex→user $30 → Alex's balance 0.

Weak spots: wrong headcount (mitigated by evidence links + confidence badge), uneven splits (equal assumed, stated in UI), cash/Venmo (visible only via messages).

## 6c. Covered-by-friend (user was covered, no user transaction)

Evidence here is testimony, not a Nessie row, so the anchor is a message or calendar event.

- **Explicit trigger (strong):** message like "I got this" / "thanks for covering me". Gemini extracts `{payer, amount?, attendees, evidence_message_id}`.
- **Implicit trigger (weak):** social event with ≥2 attendees and no user transaction near that time. Payer unknown.

Amount, in order (this is `estimate_base_cost`, the expected-cost step):
1. Stated in a message.
2. **History search:** Muse looks for past similar events (same merchant/event type) and takes the median, using the user's own past spend. Labeled `estimated`.
3. **Cold-start search:** if history finds nothing, Muse runs a *separate* web search (SerpAPI / Muse web-search tool) for a typical per-person cost of this merchant or event type, and Gemini turns the results into one number with a source link. Labeled `estimated`, confidence low. This is a distinct step so a missing history never blocks an estimate. Cache by merchant + event type.
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
1. Pick the most likely payer: Gemini names who was in the thread/calendar and said or implied "I got it"; otherwise the attendee most often the payer at past events with this group.
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

## 9. Risks

| Risk | Mitigation |
|---|---|
| Muse can't export or search as assumed | **Hour-1 spike.** If it cannot dump messages, fall back to a message JSON export / seeded messages. |
| Gemini output varies run to run | Structured output schemas, temperature 0, cache responses by input hash, ship precomputed results. |
| Wrong merges (lunch vs dinner same day) | Merge prompt sees times; keep proto-event provenance so a merge can be undone. |
| Identity resolution errors | Alias table + review queue for unknown strings. |
| Uneven splits, tips, tax, refunds | Out of scope v1; equal-split assumption stated in UI. |
| Gemini rate limits / cost | Batch job, cache, small seeded dataset. |

## 10. Work split (4 parallel streams)

A. Ingest adapters (Calendar, Muse, Nessie) → raw tables + seed loader.
B. Gemini extraction + merge → `proto_event`, `event`.
C. Relevance, debt attribution, ledger → `ledger_entry`.
D. UI: friend ledger, drill-down, review queue.

**Hour 1, before anything else:** freeze the `event`, `ledger_entry`, and `person` schemas, record them in `STRUCTURE.md`, and run the Muse spike.

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
- Gemini: `gemini-2.5-flash` is retired for new keys; default model is now `gemini-3.8-flash`.
- Tiger Data: node-pg treats `sslmode=require` as verify-full and rejects Timescale's private CA; `createDb` applies libpq semantics (`uselibpqcompat=true`: encrypted, CA not verified), same as psql.
