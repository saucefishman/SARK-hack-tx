-- Payback suggestions (DESIGN §15.5). New tables only; nothing here is a source of truth for debt (that stays ledger_entry).
-- future_event, recurring_pattern, payback_candidate, payback_suggestion are derived and rebuilt on every payback run.

CREATE TABLE future_event (
  id                     text PRIMARY KEY,
  owner_user_id          text NOT NULL DEFAULT 'p_me',
  friend_ids             text[] NOT NULL DEFAULT '{}',
  date                   date NOT NULL,
  time                   text,
  description            text NOT NULL,
  venue                  text,
  source                 text NOT NULL CHECK (source IN ('calendar','message')),
  source_refs            text[] NOT NULL DEFAULT '{}',
  headcount              integer NOT NULL DEFAULT 2,
  stated_per_person_cents integer,
  confidence             real NOT NULL DEFAULT 1
);

CREATE TABLE recurring_pattern (
  id                      text PRIMARY KEY,
  friend_id               text NOT NULL REFERENCES person(id),
  activity_key            text NOT NULL,
  occurrences             integer NOT NULL,
  last_date               date NOT NULL,
  median_gap_days         real NOT NULL,
  weekday                 integer,
  regularity              real NOT NULL,
  member_event_ids        text[] NOT NULL DEFAULT '{}',
  next_date_pred          date NOT NULL,
  per_person_low_cents    integer,
  per_person_median_cents integer,
  per_person_high_cents   integer
);

-- SerpAPI response cache, keyed by engine + normalized query + location + day.
CREATE TABLE price_quote (
  key        text PRIMARY KEY,
  engine     text NOT NULL,
  query      text NOT NULL,
  location   text NOT NULL,
  response   jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payback_candidate (
  id                     text PRIMARY KEY,
  friend_id              text NOT NULL REFERENCES person(id),
  kind                   text NOT NULL CHECK (kind IN ('planned','recurring','discovered')),
  ref_id                 text NOT NULL,
  title                  text NOT NULL,
  date                   date,
  headcount              integer NOT NULL DEFAULT 2,
  friend_share_low_cents  integer NOT NULL,
  friend_share_high_cents integer NOT NULL,
  basis                  text NOT NULL CHECK (basis IN ('confirmed','estimated')),
  confidence             real NOT NULL,
  trust                  real NOT NULL,
  activity_key           text,
  url                    text,
  evidence               text NOT NULL DEFAULT ''
);
CREATE INDEX payback_candidate_friend ON payback_candidate (friend_id);

CREATE TABLE payback_suggestion (
  id              text PRIMARY KEY,
  friend_id       text NOT NULL REFERENCES person(id),
  debt_cents      integer NOT NULL,
  candidate_ids   text[] NOT NULL,
  total_low_cents  integer NOT NULL,
  total_high_cents integer NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('exact','partial')),
  score           real NOT NULL,
  needs_transfer  boolean NOT NULL DEFAULT false,
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payback_suggestion_friend ON payback_suggestion (friend_id);

-- User-dismissed suggestions (id = payback_suggestion.id, a hash of the friend and the option set). Survives rebuilds.
CREATE TABLE payback_dismissal (
  suggestion_id text PRIMARY KEY,
  friend_id     text NOT NULL REFERENCES person(id),
  dismissed_at  timestamptz NOT NULL DEFAULT now()
);
