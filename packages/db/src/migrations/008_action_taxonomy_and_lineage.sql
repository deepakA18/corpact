-- Explicit corporate-action taxonomy (build brief Task 1a) and position lineage (Task 1b).
-- The lifecycle (announced → confirmed → activated → corrected | reversed | superseded) is derived from
-- evidence already stored with distinct timestamps: corporate_actions.issuer_created_at and ingested_at,
-- multiplier_versions.scheduled_unix and effective_unix, multiplier_writes.clock_unix, and the journal.

ALTER TABLE action_matches
  ADD COLUMN action_kind text CHECK (action_kind IN (
    'cash_dividend', 'withholding_adjustment', 'stock_dividend', 'cash_and_stock_dividend', 'forward_split', 'reverse_split',
    'unit_split', 'spin_off', 'rights_distribution', 'stock_merger', 'cash_merger', 'mixed_merger', 'identity_change',
    'redemption', 'delisting', 'seizure', 'unknown')),
  ADD COLUMN classifier_status text CHECK (classifier_status IN ('validated', 'unvalidated', 'not_built'));

-- action_matches is superseded in place (superseded_at/by), not append-only: backfill what the old classifier implied.
UPDATE action_matches SET
  action_kind = CASE classification
    WHEN 'dividend' THEN 'cash_dividend'
    WHEN 'split' THEN CASE WHEN split_factor_num >= split_factor_den THEN 'forward_split' ELSE 'reverse_split' END
    ELSE 'unknown' END,
  classifier_status = CASE classification WHEN 'unclassified' THEN 'not_built' ELSE 'validated' END;

-- Derived rows, rebuilt with every replay.
ALTER TABLE income_entries ADD COLUMN action_kind text;
-- Append-only: rows recorded before this migration keep a null action kind, derived from `kind` when read.
ALTER TABLE ledger_journal ADD COLUMN action_kind text;

-- What a mint represented over time. A new row starts a new identity; nothing is edited.
CREATE TABLE instrument_identities (
  id                bigserial PRIMARY KEY,
  mint              text NOT NULL,
  symbol            text NOT NULL,
  underlying_symbol text,
  underlying_isin   text,
  wrapper_isin      text,
  valid_from        timestamptz NOT NULL,
  issuer_event_id   text,
  evidence          text NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mint, valid_from)
);
CREATE TRIGGER instrument_identities_append_only BEFORE UPDATE OR DELETE ON instrument_identities
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- How a position's basis moves from one instrument identity to its successors, or out as cash.
-- A corrected link is a new row naming the link it supersedes.
CREATE TABLE lineage_links (
  id                 bigserial PRIMARY KEY,
  kind               text NOT NULL CHECK (kind IN ('identity_change', 'transform', 'spin_off', 'terminate')),
  effective_at       timestamptz NOT NULL,
  issuer_event_id    text,
  issuer_revision    integer,
  from_identity_id   bigint NOT NULL REFERENCES instrument_identities (id),
  cash_basis_num     numeric NOT NULL CHECK (cash_basis_num >= 0),
  cash_basis_den     numeric NOT NULL CHECK (cash_basis_den > 0),
  classifier_status  text NOT NULL CHECK (classifier_status IN ('validated', 'unvalidated', 'not_built')),
  supersedes_id      bigint UNIQUE REFERENCES lineage_links (id),
  recorded_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER lineage_links_append_only BEFORE UPDATE OR DELETE ON lineage_links
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE lineage_successors (
  link_id              bigint NOT NULL REFERENCES lineage_links (id),
  identity_id          bigint NOT NULL REFERENCES instrument_identities (id),
  basis_num            numeric NOT NULL CHECK (basis_num >= 0),
  basis_den            numeric NOT NULL CHECK (basis_den > 0),
  quantity_factor_num  numeric,
  quantity_factor_den  numeric CHECK (quantity_factor_den IS NULL OR quantity_factor_den > 0),
  PRIMARY KEY (link_id, identity_id)
);
CREATE TRIGGER lineage_successors_append_only BEFORE UPDATE OR DELETE ON lineage_successors
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
