-- Stock dividends, rights, identity changes and withholding refunds (build brief Tasks 2.2–2.6).
-- A new ledger treatment, `identity_change`: the same position in a new underlying form, units rescaled by a verified ratio.
-- Stock dividends reuse `split` (quantity × factor, zero income); rights reuse `distribution`; refunds reuse `dividend`.

ALTER TABLE action_matches DROP CONSTRAINT action_matches_action_kind_check;
ALTER TABLE action_matches ADD CONSTRAINT action_matches_action_kind_check CHECK (action_kind IN (
  'cash_dividend', 'withholding_adjustment', 'stock_dividend', 'cash_and_stock_dividend', 'forward_split', 'reverse_split',
  'unit_split', 'cash_in_lieu', 'spin_off', 'rights_distribution', 'stock_merger', 'cash_merger', 'mixed_merger', 'identity_change',
  'redemption', 'delisting', 'seizure', 'unknown'));

ALTER TABLE action_matches DROP CONSTRAINT action_matches_classification_check;
ALTER TABLE action_matches ADD CONSTRAINT action_matches_classification_check
  CHECK (classification IN ('dividend', 'split', 'distribution', 'identity_change', 'unclassified'));
ALTER TABLE action_matches
  -- A currency retention the issuer published in its withholding-rate field. Not tax; never deducted again.
  ADD COLUMN retention_rate numeric CHECK (retention_rate IS NULL OR (retention_rate >= 0 AND retention_rate < 1)),
  -- For a withholding refund: the issuer's explanation, which is the evidence.
  ADD COLUMN refund_note text,
  -- For an identity change: the underlying listing before and after, as the issuer note states them.
  ADD COLUMN from_underlying text,
  ADD COLUMN to_underlying text;

ALTER TABLE income_entries DROP CONSTRAINT income_entries_kind_check;
ALTER TABLE income_entries ADD CONSTRAINT income_entries_kind_check
  CHECK (kind IN ('dividend', 'split', 'distribution', 'identity_change', 'unclassified_adjustment'));

-- Append-only: a constraint change alters no existing row.
ALTER TABLE ledger_journal DROP CONSTRAINT ledger_journal_kind_check;
ALTER TABLE ledger_journal ADD CONSTRAINT ledger_journal_kind_check
  CHECK (kind IN ('dividend', 'split', 'distribution', 'identity_change', 'unclassified_adjustment'));

CREATE INDEX lineage_links_by_event ON lineage_links (issuer_event_id, issuer_revision);
CREATE INDEX instrument_identities_by_mint ON instrument_identities (mint, valid_from);
