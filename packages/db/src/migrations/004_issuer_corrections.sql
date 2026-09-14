-- Issuer corrections (PLAN §5.3, §6.5, §14). Interpretations are superseded, never overwritten,
-- and every change to recognized income is journaled as a reversal plus a replacement.

ALTER TABLE action_matches DROP CONSTRAINT action_matches_multiplier_version_id_classifier_version_key;
ALTER TABLE action_matches
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN superseded_by bigint REFERENCES action_matches (id);
CREATE UNIQUE INDEX action_matches_one_current ON action_matches (multiplier_version_id) WHERE superseded_at IS NULL;

CREATE TABLE ledger_journal (
  id                    bigserial PRIMARY KEY,
  owner                 text NOT NULL,
  mint                  text NOT NULL,
  multiplier_version_id bigint NOT NULL REFERENCES multiplier_versions (id),
  entry_type            text NOT NULL CHECK (entry_type IN ('recognition', 'reversal')),
  kind                  text NOT NULL CHECK (kind IN ('dividend', 'split', 'unclassified_adjustment')),
  effective_unix        bigint NOT NULL,
  quantity_num          numeric NOT NULL,
  quantity_den          numeric NOT NULL CHECK (quantity_den > 0),
  split_factor_num      numeric,
  split_factor_den      numeric,
  usd                   numeric,
  valuation             text CHECK (valuation IN ('issuer_net_cash', 'market_estimate')),
  action_match_id       bigint REFERENCES action_matches (id),
  issuer_event_id       text,
  issuer_revision       integer,
  -- A reversal names the recognition it cancels; each recognition can be reversed at most once.
  reverses_id           bigint UNIQUE REFERENCES ledger_journal (id),
  change_reason         text NOT NULL CHECK (change_reason IN ('initial', 'issuer_correction', 'balance_history_changed', 'valuation_changed', 'no_longer_applicable')),
  change_detail         text,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((entry_type = 'reversal') = (reverses_id IS NOT NULL))
);
CREATE INDEX ledger_journal_by_position ON ledger_journal (owner, mint, multiplier_version_id);
CREATE TRIGGER ledger_journal_append_only BEFORE UPDATE OR DELETE ON ledger_journal
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE income_entries
  ADD COLUMN interpretation_revision integer NOT NULL DEFAULT 1 CHECK (interpretation_revision >= 1),
  ADD COLUMN last_corrected_at timestamptz;
