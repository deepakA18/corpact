-- Tenancy: every API key belongs to a tenant, carries explicit scopes, and can only
-- read wallets its tenant has registered (bounded by a per-tenant quota).

CREATE TABLE tenants (
  id          bigserial PRIMARY KEY,
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name        text NOT NULL,
  max_wallets integer NOT NULL DEFAULT 100 CHECK (max_wallets > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_wallets (
  tenant_id bigint NOT NULL REFERENCES tenants (id),
  owner     text NOT NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, owner)
);

ALTER TABLE api_keys
  ADD COLUMN tenant_id bigint REFERENCES tenants (id),
  ADD COLUMN scopes text[] NOT NULL DEFAULT '{}';

-- Keys issued before tenancy keep working: they move to a 'default' tenant with every
-- scope, and that tenant inherits the wallets already synced. Fresh databases skip this.
INSERT INTO tenants (slug, name, max_wallets)
SELECT 'default', 'Default (keys issued before tenancy)', 1000
WHERE EXISTS (SELECT 1 FROM api_keys);

UPDATE api_keys
   SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default'),
       scopes = ARRAY['assets:read', 'ledger:read', 'wallets:sync']
 WHERE tenant_id IS NULL;

INSERT INTO tenant_wallets (tenant_id, owner)
SELECT t.id, w.owner FROM wallet_syncs w CROSS JOIN tenants t
 WHERE t.slug = 'default'
ON CONFLICT DO NOTHING;

ALTER TABLE api_keys
  ALTER COLUMN tenant_id SET NOT NULL,
  ADD CONSTRAINT api_keys_scopes_known CHECK (scopes <@ ARRAY['assets:read', 'ledger:read', 'wallets:sync']::text[]);
