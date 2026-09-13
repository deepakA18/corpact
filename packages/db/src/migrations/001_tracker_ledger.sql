-- Tracker ledger, PLAN §8 (observe-only subset: no policies, intents, attempts or receipts).
-- Raw token amounts: numeric(20,0). Floors and quantities: exact rational num/den.
-- USD: numeric with no scale (exact), NULL meaning unknown — never zero.
-- No floating-point columns hold ledger values; multipliers are stored as their exact f64 bytes.

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END
$$;

CREATE TABLE assets (
  mint                text PRIMARY KEY,
  issuer              text NOT NULL,
  symbol              text NOT NULL,
  name                text,
  underlying_symbol   text,
  registry_source     text NOT NULL CHECK (registry_source IN ('fixtures', 'live')),
  -- Filled only by live mint verification; NULL means not yet verified on chain.
  token_program       text,
  decimals            smallint,
  extension_types     integer[],
  scaled_ui_authority text,
  verified_slot       numeric(20, 0),
  verification_error  text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_cursors (
  stream           text PRIMARY KEY,
  finalized_slot   numeric(20, 0),
  history_complete boolean NOT NULL DEFAULT false,
  gaps             jsonb NOT NULL DEFAULT '[]',
  state            jsonb NOT NULL DEFAULT '{}',
  checkpoint_hash  text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- A transaction's position within its block, from getBlock. The only source of intra-slot order.
CREATE TABLE transaction_indexes (
  signature text PRIMARY KEY,
  slot      numeric(20, 0) NOT NULL,
  tx_index  integer NOT NULL CHECK (tx_index >= 0)
);

-- Signature index per address, as returned by getSignaturesForAddress.
CREATE TABLE address_signatures (
  address         text NOT NULL,
  signature       text NOT NULL,
  slot            numeric(20, 0) NOT NULL,
  block_time_unix bigint,
  failed          boolean NOT NULL,
  PRIMARY KEY (address, signature)
);
CREATE INDEX address_signatures_by_time ON address_signatures (address, block_time_unix);

-- Immutable raw provider payloads, stored before any interpretation.
CREATE TABLE chain_observations (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('transaction', 'mint_state', 'token_accounts')),
  signature       text NOT NULL DEFAULT '',
  subject         text NOT NULL DEFAULT '',
  slot            numeric(20, 0) NOT NULL,
  block_time_unix bigint,
  commitment      text NOT NULL DEFAULT 'finalized',
  payload         jsonb NOT NULL,
  payload_sha256  text NOT NULL,
  observed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, signature, subject, slot)
);
CREATE TRIGGER chain_observations_append_only BEFORE UPDATE OR DELETE ON chain_observations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Decoded ScaledUiAmount instructions, exactly as written.
CREATE TABLE multiplier_writes (
  id               bigserial PRIMARY KEY,
  mint             text NOT NULL,
  signature        text NOT NULL,
  slot             numeric(20, 0) NOT NULL,
  instruction_path integer[] NOT NULL,
  clock_unix       bigint NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('initialize', 'update')),
  multiplier_bits  text NOT NULL CHECK (multiplier_bits ~ '^[0-9a-f]{16}$'),
  effective_unix   bigint NOT NULL,
  observation_id   bigint NOT NULL REFERENCES chain_observations (id),
  UNIQUE (signature, instruction_path)
);
CREATE INDEX multiplier_writes_by_mint ON multiplier_writes (mint, slot);
CREATE TRIGGER multiplier_writes_append_only BEFORE UPDATE OR DELETE ON multiplier_writes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Derived timeline (PLAN §5.1 MultiplierTransition). Rebuilt from multiplier_writes.
CREATE TABLE multiplier_versions (
  id                        bigserial PRIMARY KEY,
  mint                      text NOT NULL,
  update_signature          text NOT NULL,
  observed_slot             numeric(20, 0) NOT NULL,
  observed_tx_index         integer,
  observed_instruction_path integer[] NOT NULL,
  scheduled_unix            bigint NOT NULL,
  effective_unix            bigint NOT NULL,
  immediate                 boolean NOT NULL,
  old_multiplier_bits       text CHECK (old_multiplier_bits ~ '^[0-9a-f]{16}$'),
  new_multiplier_bits       text NOT NULL CHECK (new_multiplier_bits ~ '^[0-9a-f]{16}$'),
  old_multiplier_exact      numeric,
  new_multiplier_exact      numeric NOT NULL,
  status                    text NOT NULL CHECK (status IN ('scheduled', 'active', 'superseded', 'orphaned')),
  config_hash               text NOT NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mint, update_signature, observed_instruction_path)
);
CREATE INDEX multiplier_versions_by_mint ON multiplier_versions (mint, effective_unix);

CREATE TABLE corporate_actions (
  issuer               text NOT NULL,
  external_id          text NOT NULL,
  revision             integer NOT NULL,
  symbol               text NOT NULL,
  kind                 text NOT NULL,
  status               text NOT NULL,
  effective_at         timestamptz,
  issuer_created_at    timestamptz NOT NULL,
  multiplier_old       text,
  multiplier_new       text,
  gross_cash_per_share numeric,
  net_cash_per_share   numeric,
  withholding_rate     numeric,
  from_units           numeric,
  to_units             numeric,
  notes                text,
  source               text NOT NULL CHECK (source IN ('fixtures', 'live')),
  payload              jsonb NOT NULL,
  evidence_sha256      text NOT NULL,
  ingested_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, external_id, revision)
);
CREATE INDEX corporate_actions_by_symbol ON corporate_actions (symbol);
CREATE TRIGGER corporate_actions_append_only BEFORE UPDATE OR DELETE ON corporate_actions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE action_matches (
  id                    bigserial PRIMARY KEY,
  multiplier_version_id bigint NOT NULL REFERENCES multiplier_versions (id),
  classifier_version    text NOT NULL,
  classification        text NOT NULL CHECK (classification IN ('dividend', 'split', 'unclassified')),
  issuer                text,
  external_id           text,
  revision              integer,
  net_cash_per_share    numeric,
  split_factor_num      numeric,
  split_factor_den      numeric CHECK (split_factor_den IS NULL OR split_factor_den > 0),
  reasons               jsonb NOT NULL DEFAULT '[]',
  warnings              jsonb NOT NULL DEFAULT '[]',
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (multiplier_version_id, classifier_version)
);

CREATE TABLE token_accounts (
  address          text PRIMARY KEY,
  mint             text NOT NULL,
  token_program    text,
  first_seen_slot  numeric(20, 0),
  last_seen_slot   numeric(20, 0),
  closed_slot      numeric(20, 0),
  history_complete boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE balance_movements (
  id              bigserial PRIMARY KEY,
  signature       text NOT NULL,
  slot            numeric(20, 0) NOT NULL,
  block_time_unix bigint NOT NULL,
  account         text NOT NULL,
  mint            text NOT NULL,
  owner_before    text,
  owner_after     text,
  raw_before      numeric(20, 0) NOT NULL CHECK (raw_before >= 0),
  raw_after       numeric(20, 0) NOT NULL CHECK (raw_after >= 0),
  reason          text NOT NULL CHECK (reason IN ('mint', 'burn', 'transfer', 'open', 'close', 'owner_change')),
  observation_id  bigint NOT NULL REFERENCES chain_observations (id),
  UNIQUE (signature, account)
);
CREATE INDEX balance_movements_by_account ON balance_movements (account, slot);
CREATE INDEX balance_movements_by_owner_before ON balance_movements (owner_before, mint);
CREATE INDEX balance_movements_by_owner_after ON balance_movements (owner_after, mint);
CREATE TRIGGER balance_movements_append_only BEFORE UPDATE OR DELETE ON balance_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE wallet_syncs (
  owner                 text PRIMARY KEY,
  status                text NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'partial', 'failed')),
  requested_at          timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  as_of_slot            numeric(20, 0),
  as_of_unix            bigint,
  transactions_fetched  integer NOT NULL DEFAULT 0,
  gaps                  jsonb NOT NULL DEFAULT '[]',
  error                 text,
  progress              jsonb NOT NULL DEFAULT '{}'
);

-- Intentionally empty this iteration: no event-time price source exists yet.
CREATE TABLE prices (
  id          bigserial PRIMARY KEY,
  mint        text NOT NULL,
  observed_at timestamptz NOT NULL,
  unit_basis  text NOT NULL CHECK (unit_basis IN ('scaled', 'unscaled')),
  value_usd   numeric NOT NULL CHECK (value_usd > 0),
  source      text NOT NULL,
  stale       boolean NOT NULL DEFAULT false,
  UNIQUE (mint, observed_at, source)
);

-- Derived per rebuild; replaced atomically with its income entries.
CREATE TABLE position_epochs (
  id                          bigserial PRIMARY KEY,
  owner                       text NOT NULL,
  mint                        text NOT NULL,
  epoch                       integer NOT NULL,
  status                      text NOT NULL CHECK (status IN ('complete', 'partial', 'unsupported')),
  coverage_start_unix         bigint,
  coverage_start_slot         numeric(20, 0),
  coverage_end_unix           bigint,
  coverage_end_slot           numeric(20, 0),
  gaps                        jsonb NOT NULL DEFAULT '[]',
  raw_balance                 numeric(20, 0) NOT NULL CHECK (raw_balance >= 0),
  decimals                    smallint NOT NULL,
  multiplier_bits             text NOT NULL CHECK (multiplier_bits ~ '^[0-9a-f]{16}$'),
  floor_num                   numeric NOT NULL,
  floor_den                   numeric NOT NULL CHECK (floor_den > 0),
  conversion_disabled_reasons jsonb NOT NULL DEFAULT '[]',
  -- False when replay stopped early; the floor then describes an earlier state and no availability may be derived.
  replay_complete             boolean NOT NULL,
  reconciled                  boolean NOT NULL,
  ledger_version              text NOT NULL,
  computed_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner, mint, epoch)
);

CREATE TABLE income_entries (
  id                    bigserial PRIMARY KEY,
  position_epoch_id     bigint NOT NULL REFERENCES position_epochs (id) ON DELETE CASCADE,
  seq                   integer NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('dividend', 'split', 'unclassified_adjustment')),
  multiplier_version_id bigint NOT NULL REFERENCES multiplier_versions (id),
  -- NULL while classification is pending; such entries are always unclassified adjustments.
  action_match_id       bigint REFERENCES action_matches (id),
  effective_unix        bigint NOT NULL,
  quantity_num          numeric NOT NULL,
  quantity_den          numeric NOT NULL CHECK (quantity_den > 0),
  split_factor_num      numeric,
  split_factor_den      numeric,
  usd                   numeric,
  valuation             text CHECK (valuation IN ('issuer_net_cash', 'market_estimate')),
  price_id              bigint REFERENCES prices (id),
  warnings              jsonb NOT NULL DEFAULT '[]',
  reasons               jsonb NOT NULL DEFAULT '[]',
  UNIQUE (position_epoch_id, seq),
  CHECK (usd IS NULL OR valuation IS NOT NULL)
);

CREATE TABLE reconciliation_checks (
  id         bigserial PRIMARY KEY,
  owner      text NOT NULL,
  mint       text NOT NULL,
  account    text,
  slot       numeric(20, 0) NOT NULL,
  chain_raw  numeric(20, 0) NOT NULL,
  ledger_raw numeric(20, 0) NOT NULL,
  matched    boolean NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs_outbox (
  id               bigserial PRIMARY KEY,
  kind             text NOT NULL,
  business_key     text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 5,
  run_after        timestamptz NOT NULL DEFAULT now(),
  lease_owner      text,
  lease_expires_at timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- Dedup pending work only: a request that arrives while the same job is running must queue a follow-up, not vanish.
CREATE UNIQUE INDEX jobs_outbox_one_pending_per_key ON jobs_outbox (business_key) WHERE status = 'pending';
CREATE INDEX jobs_outbox_ready ON jobs_outbox (run_after) WHERE status = 'pending';
