-- Spin-offs delivered as value reinvested into the parent (build brief Task 2.2; every recorded xStocks spin-off).
-- A new ledger treatment, `distribution`: units added are principal with allocated basis, never income.

ALTER TABLE action_matches DROP CONSTRAINT action_matches_classification_check;
ALTER TABLE action_matches ADD CONSTRAINT action_matches_classification_check
  CHECK (classification IN ('dividend', 'split', 'distribution', 'unclassified'));
ALTER TABLE action_matches
  ADD COLUMN distributed_fraction_num numeric,
  ADD COLUMN distributed_fraction_den numeric CHECK (distributed_fraction_den IS NULL OR distributed_fraction_den > 0),
  -- Issuer cash per underlying share for the distributed value, when published and plausible.
  ADD COLUMN proceeds_per_share numeric;

ALTER TABLE income_entries DROP CONSTRAINT income_entries_kind_check;
ALTER TABLE income_entries ADD CONSTRAINT income_entries_kind_check
  CHECK (kind IN ('dividend', 'split', 'distribution', 'unclassified_adjustment'));
ALTER TABLE income_entries
  ADD COLUMN distributed_fraction_num numeric,
  ADD COLUMN distributed_fraction_den numeric CHECK (distributed_fraction_den IS NULL OR distributed_fraction_den > 0),
  ADD COLUMN proceeds_usd numeric;

-- Append-only: a constraint and nullable columns change no existing row.
ALTER TABLE ledger_journal DROP CONSTRAINT ledger_journal_kind_check;
ALTER TABLE ledger_journal ADD CONSTRAINT ledger_journal_kind_check
  CHECK (kind IN ('dividend', 'split', 'distribution', 'unclassified_adjustment'));
ALTER TABLE ledger_journal
  ADD COLUMN distributed_fraction_num numeric,
  ADD COLUMN distributed_fraction_den numeric CHECK (distributed_fraction_den IS NULL OR distributed_fraction_den > 0),
  ADD COLUMN proceeds_usd numeric;
