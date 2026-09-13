-- API keys. Only a SHA-256 of each key is stored; the key itself is shown once at creation.
CREATE TABLE api_keys (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL,
  prefix       text NOT NULL,
  key_sha256   text NOT NULL UNIQUE CHECK (key_sha256 ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
