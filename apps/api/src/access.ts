import { withTransaction, type Db, type Queryable } from '@corpact/db';

export const SCOPES = ['assets:read', 'ledger:read', 'wallets:sync', 'ops:read'] as const;
export type Scope = (typeof SCOPES)[number];
export const DEFAULT_KEY_SCOPES: readonly Scope[] = ['assets:read', 'ledger:read'];

export function parseScopes(text: string): Scope[] {
  const scopes = text.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
  if (unknown.length) throw new Error(`Unknown scope(s): ${unknown.join(', ')}. Known: ${SCOPES.join(', ')}`);
  return [...new Set(scopes)] as Scope[];
}

export type Registration = 'registered' | 'already_registered' | 'quota_exceeded';

/** Which wallets a tenant may read. */
export interface AccessStore {
  isRegistered(tenantId: string, owner: string): Promise<boolean>;
  register(tenantId: string, owner: string): Promise<Registration>;
  list(tenantId: string): Promise<{ tenant: string; maxWallets: number; wallets: Array<{ owner: string; addedAt: Date }> }>;
}

export function dbAccessStore(db: Db): AccessStore {
  return {
    async isRegistered(tenantId, owner) {
      const { rowCount } = await db.query('SELECT 1 FROM tenant_wallets WHERE tenant_id = $1 AND owner = $2', [tenantId, owner]);
      return (rowCount ?? 0) > 0;
    },
    async register(tenantId, owner) {
      return withTransaction(db, async (client) => {
        // Lock the tenant row so concurrent registrations cannot overshoot the quota.
        const { rows } = await client.query('SELECT max_wallets FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
        if (!rows[0]) throw new Error(`Tenant ${tenantId} does not exist`);
        const existing = await client.query('SELECT 1 FROM tenant_wallets WHERE tenant_id = $1 AND owner = $2', [tenantId, owner]);
        if (existing.rowCount) return 'already_registered';
        const count = await client.query('SELECT count(*)::int AS n FROM tenant_wallets WHERE tenant_id = $1', [tenantId]);
        if (count.rows[0].n >= rows[0].max_wallets) return 'quota_exceeded';
        await client.query('INSERT INTO tenant_wallets (tenant_id, owner) VALUES ($1, $2)', [tenantId, owner]);
        return 'registered';
      });
    },
    async list(tenantId) {
      const { rows: tenants } = await db.query('SELECT slug, max_wallets FROM tenants WHERE id = $1', [tenantId]);
      if (!tenants[0]) throw new Error(`Tenant ${tenantId} does not exist`);
      const { rows } = await db.query('SELECT owner, added_at FROM tenant_wallets WHERE tenant_id = $1 ORDER BY added_at, owner', [tenantId]);
      return {
        tenant: tenants[0].slug as string,
        maxWallets: tenants[0].max_wallets as number,
        wallets: rows.map((r) => ({ owner: r.owner as string, addedAt: r.added_at as Date })),
      };
    },
  };
}

export async function createTenant(q: Queryable, tenant: { slug: string; name: string; maxWallets?: number }) {
  const { rows } = await q.query('INSERT INTO tenants (slug, name, max_wallets) VALUES ($1, $2, $3) RETURNING id', [
    tenant.slug,
    tenant.name,
    tenant.maxWallets ?? 100,
  ]);
  return { id: String(rows[0].id) };
}

export async function listTenants(q: Queryable) {
  const { rows } = await q.query(
    `SELECT t.id, t.slug, t.name, t.max_wallets,
            (SELECT count(*) FROM tenant_wallets w WHERE w.tenant_id = t.id)::int AS wallets,
            (SELECT count(*) FROM api_keys k WHERE k.tenant_id = t.id AND k.revoked_at IS NULL)::int AS active_keys
       FROM tenants t ORDER BY t.id`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    slug: r.slug as string,
    name: r.name as string,
    maxWallets: r.max_wallets as number,
    wallets: r.wallets as number,
    activeKeys: r.active_keys as number,
  }));
}
