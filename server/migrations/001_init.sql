-- Schema from DESIGN.md section 5. Contract: change together with packages/shared/src/domain.ts.
-- Money columns are integer cents (*_cents). Ids are text (deterministic, e.g. 'p_alex', event hashes).

-- pgvector: enabled when available (Tiger Data), unused in MVP. Never fails the migration.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'vector extension unavailable, skipping';
END $$;

CREATE TABLE person (
  id               text PRIMARY KEY,
  display_name     text NOT NULL,
  is_user          boolean NOT NULL DEFAULT false,
  platform_user_id text            -- TODO(stub): social
);

CREATE TABLE person_alias (
  person_id text REFERENCES person(id) ON DELETE CASCADE, -- null = candidate awaiting review
  kind      text NOT NULL CHECK (kind IN ('display_name','nickname','phone','email','handle','merchant_name')),
  value     text NOT NULL,          -- stored lowercased/trimmed for matching
  status    text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','candidate')),
  PRIMARY KEY (kind, value)
);

CREATE TABLE message (
  id          text PRIMARY KEY,
  thread_id   text NOT NULL,
  sender_id   text REFERENCES person(id),
  sender_name text NOT NULL,
  sent_at     timestamptz NOT NULL,
  body        text NOT NULL,
  embedding   real[]              -- optional in v1 (pgvector deferred)
);
CREATE INDEX message_thread_sent ON message (thread_id, sent_at);

CREATE TABLE calendar_event (
  id           text PRIMARY KEY,
  title        text NOT NULL,
  description  text,
  start_at     timestamptz NOT NULL,
  end_at       timestamptz,
  attendee_ids text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE txn (
  id                text PRIMARY KEY,
  nessie_id         text NOT NULL UNIQUE,
  kind              text NOT NULL CHECK (kind IN ('purchase','transfer')),
  amount_cents      integer NOT NULL,
  merchant          text,
  merchant_category text,
  description       text,
  occurred_on       date NOT NULL,   -- Nessie: date only
  payer_id          text NOT NULL REFERENCES person(id)
);

CREATE TABLE proto_event (
  id          text PRIMARY KEY,
  source      text NOT NULL CHECK (source IN ('calendar','message','txn')),
  source_ref  text NOT NULL,
  date        date NOT NULL,
  time        text,
  description text,
  people_ids  text[] NOT NULL DEFAULT '{}',
  details     jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE canonical_event (       -- TODO(stub): social — unused in MVP
  id               text PRIMARY KEY,
  date             date NOT NULL,
  merchant         text,
  total_cents      integer,
  headcount        integer,
  member_event_ids text[] NOT NULL DEFAULT '{}',
  confidence       real
);

CREATE TABLE event (
  id                  text PRIMARY KEY,  -- hash(date + sorted attendees + anchor)
  owner_user_id       text NOT NULL DEFAULT 'p_me',          -- TODO(stub): social
  canonical_event_id  text REFERENCES canonical_event(id),   -- TODO(stub): social
  date                date NOT NULL,
  time                text,
  description         text NOT NULL,
  attendee_ids        text[] NOT NULL DEFAULT '{}',
  total_cents         integer,
  source_count        integer NOT NULL DEFAULT 1,
  is_relevant         boolean NOT NULL DEFAULT false,
  confidence          real NOT NULL DEFAULT 0,
  context_message_ids text[] NOT NULL DEFAULT '{}',
  anchor_txn_id       text REFERENCES txn(id)
);

CREATE TABLE event_payer (
  event_id            text NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  person_id           text NOT NULL REFERENCES person(id),
  amount_cents        integer,
  basis               text NOT NULL CHECK (basis IN ('confirmed','assumed','estimated','crowd')),
  evidence_message_id text REFERENCES message(id),
  txn_id              text REFERENCES txn(id),
  PRIMARY KEY (event_id, person_id)
);

CREATE TABLE event_source (
  event_id       text NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  proto_event_id text NOT NULL REFERENCES proto_event(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, proto_event_id)
);

CREATE TABLE ledger_entry (
  id                  text PRIMARY KEY,
  event_id            text REFERENCES event(id) ON DELETE CASCADE,
  payer_id            text NOT NULL REFERENCES person(id),
  beneficiary_id      text REFERENCES person(id),   -- null only for unaccounted
  amount_cents        integer NOT NULL CHECK (amount_cents >= 0),
  kind                text NOT NULL CHECK (kind IN ('covered','repayment','unaccounted')),
  basis               text NOT NULL CHECK (basis IN ('confirmed','assumed','estimated','crowd')),
  confidence          real NOT NULL DEFAULT 1,
  evidence_message_id text REFERENCES message(id),
  txn_id              text REFERENCES txn(id)
);
CREATE INDEX ledger_entry_event ON ledger_entry (event_id);

CREATE TABLE review_item (
  id         text PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('alias','attendees','payer')),
  txn_id     text REFERENCES txn(id),
  event_id   text REFERENCES event(id) ON DELETE CASCADE,
  question   text NOT NULL,
  option_ids text[] NOT NULL DEFAULT '{}',
  answer     jsonb,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Implementation-only: Gemini record/replay cache (BUILDPLAN Phase 3).
CREATE TABLE llm_cache (
  key        text PRIMARY KEY,   -- sha256(promptId + promptVersion + model + canonical JSON input)
  model      text NOT NULL,
  prompt_id  text NOT NULL,
  response   jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
