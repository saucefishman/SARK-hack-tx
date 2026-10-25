# Council transcript — 2026-10-24

Question: review/elaborate the "How Much Do Your Friends Cost?" stage-1 system design (see original brief in session). Advisor and reviewer text below is condensed.

## Anonymization map (peer review)
A = Outsider, B = Contrarian, C = Executor, D = Expansionist, E = First Principles

## Advisors
- **Contrarian (B):** Nessie synthetic, no ground truth. Expected-minus-actual is a guess about a guess; can't tell "paid for everyone" from "ate more". Repayment NLP is hardest and last; unaccounted swallows result. O(n^2) LLM dedupe merges lunch/dinner. Four integration points; Muse unknown. Cuts: drop SerpAPI, binary rule, anchor on transactions, batch, even split, show unaccounted, keep ask-user.
- **First Principles (E):** Wrong question. Minimum evidence = a transaction. Debt = (payer, beneficiaries, amount). Invert to transaction-first; Gemini returns {attendees, split_guess, confidence}; share = amount/attendees; repayment check. Drop proto events, scoring, web baselines; defer pgvector; keep ask-user.
- **Expansionist (D):** Real product is a friend ledger with receipts. "What is this?" is a labeling flywheel. Reciprocity/overdue view, settle-up drafts, v2 shared ledger. Cuts: SerpAPI, same-day matching, seeded dataset.
- **Outsider (A):** Pitch undefined ("covered whom"); open the doc with demo output; define jargon; expected-minus-actual looks wrong; ~9 LLM steps. Cuts: drop calendar/pgvector, messages + transactions only, detect payments directly, seed data, leaderboard.
- **Executor (C):** Sound but 3x too big. Hour-1 Muse spike. Debt readable straight from messages + payer. Offline batch. Cut ask-user UI, pgvector, web search; merge steps 1–2; binary relevance rule; even split. Freeze schema hour 1; 4-way parallel split; seeded data.

## Peer review (5 reviewers)
- All 5: strongest = E (removes circular math, concrete pipeline); B and C close seconds.
- All 5: biggest blind spot = D (adds scope, ignores what breaks); A second.
- Missed by all: privacy/consent; identity resolution; evaluation/ground truth; demo narrative; Gemini rate limits/fallback; multi-payer netting, sign convention, idempotent reruns; uneven splits/tips/refunds; payments outside Nessie.

## Chairman verdict
**Agree:** expected-minus-actual is circular; Nessie is synthetic so seed data; cut SerpAPI/scoring matrix/pgvector; batch not live; keep unaccounted and the ask-user prompt; output a per-friend ledger.
**Clash:** (1) E/B want fully transaction-first and drop proto events; A wants messages+transactions only (drop calendar); C/D keep three sources. (2) Keep ask-user: E, B, D yes; C cuts for v1. (3) pgvector: D keeps for similarity; others drop.
**Blind spots caught in review:** identity resolution, evaluation set, privacy, signed/idempotent ledger.
**Recommendation:** transaction-anchored debt with calendar and messages as context (E's flow inside the user's Event model), binary relevance rule, per-day single merge pass, batch with seeded data, hand-labeled eval set. Keep ask-user as a simple review queue (C's cut is a UI cost, not a pipeline cost). Result is in `DESIGN.md`.
**Do first:** freeze the Event/ledger/person schemas and spike Muse export in hour 1.
