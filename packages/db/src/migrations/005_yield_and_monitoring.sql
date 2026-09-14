-- Quantity timeline per position (time-weighted yield, PLAN §7), worker heartbeats and
-- RPC budget counters (PLAN §14), and the ops:read scope for monitoring endpoints.

CREATE TABLE position_quantity_samples (
  position_epoch_id bigint NOT NULL REFERENCES position_epochs (id) ON DELETE CASCADE,
  seq               integer NOT NULL,
  -- Holdings from this instant until the next sample, in displayed units at that instant.
  effective_unix    bigint NOT NULL,
  quantity_num      numeric NOT NULL,
  quantity_den      numeric NOT NULL CHECK (quantity_den > 0),
  PRIMARY KEY (position_epoch_id, seq)
);

CREATE TABLE worker_heartbeats (
  worker_id         text PRIMARY KEY,
  started_at        timestamptz NOT NULL,
  last_seen_at      timestamptz NOT NULL,
  last_job_kind     text,
  last_job_at       timestamptz,
  mint_poll_seconds integer NOT NULL CHECK (mint_poll_seconds > 0),
  rpc_host          text,
  rpc_requests      bigint NOT NULL DEFAULT 0,
  rpc_retries       bigint NOT NULL DEFAULT 0,
  rpc_failures      bigint NOT NULL DEFAULT 0
);

ALTER TABLE api_keys DROP CONSTRAINT api_keys_scopes_known;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_known
  CHECK (scopes <@ ARRAY['assets:read', 'ledger:read', 'wallets:sync', 'ops:read']::text[]);
