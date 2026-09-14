-- Independent reconciliation provider (PLAN Appendix B) and evidence hashes that can be re-verified
-- from the database itself, e.g. after a restore.

CREATE TABLE provider_checks (
  id             bigserial PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('token_balances', 'mint_state')),
  -- Owner address for token_balances, mint address for mint_state.
  subject        text NOT NULL,
  primary_host   text NOT NULL,
  secondary_host text NOT NULL,
  primary_slot   numeric(20, 0) NOT NULL,
  secondary_slot numeric(20, 0),
  outcome        text NOT NULL CHECK (outcome IN ('agree', 'disagree', 'inconclusive')),
  details        jsonb NOT NULL DEFAULT '[]',
  checked_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_checks_by_subject ON provider_checks (kind, subject, id DESC);
CREATE TRIGGER provider_checks_append_only BEFORE UPDATE OR DELETE ON provider_checks
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE worker_heartbeats ADD COLUMN reconciliation_rpc_host text;

-- payload_sha256 and evidence_sha256 hash the JSON text as first serialized. jsonb keeps the value but not
-- that text (it reorders keys), so those hashes cannot be recomputed from the database. stored_payload_sha256
-- hashes Postgres' own rendering of the stored jsonb, which survives dump and restore. Rows that predate this
-- migration are sealed now rather than at ingestion, and say so. Filling the new column is the only write this
-- migration makes to an append-only table, with its guard lifted for that statement alone.

ALTER TABLE chain_observations ADD COLUMN stored_payload_sha256 text;
ALTER TABLE chain_observations ADD COLUMN hash_sealed_at_ingestion boolean NOT NULL DEFAULT false;
ALTER TABLE chain_observations ALTER COLUMN hash_sealed_at_ingestion SET DEFAULT true;
ALTER TABLE chain_observations DISABLE TRIGGER chain_observations_append_only;
UPDATE chain_observations SET stored_payload_sha256 = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
ALTER TABLE chain_observations ENABLE TRIGGER chain_observations_append_only;
ALTER TABLE chain_observations ALTER COLUMN stored_payload_sha256 SET NOT NULL;

ALTER TABLE corporate_actions ADD COLUMN stored_payload_sha256 text;
ALTER TABLE corporate_actions ADD COLUMN hash_sealed_at_ingestion boolean NOT NULL DEFAULT false;
ALTER TABLE corporate_actions ALTER COLUMN hash_sealed_at_ingestion SET DEFAULT true;
ALTER TABLE corporate_actions DISABLE TRIGGER corporate_actions_append_only;
UPDATE corporate_actions SET stored_payload_sha256 = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
ALTER TABLE corporate_actions ENABLE TRIGGER corporate_actions_append_only;
ALTER TABLE corporate_actions ALTER COLUMN stored_payload_sha256 SET NOT NULL;
