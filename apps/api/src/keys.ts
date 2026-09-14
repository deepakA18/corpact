import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '@corpact/db';
import type { Scope } from './access';

export interface ApiKeyIdentity {
  id: string;
  name: string;
  tenantId: string;
  tenant: string;
  scopes: Scope[];
}

export interface ApiKeyStore {
  findActiveByHash(sha256: string): Promise<ApiKeyIdentity | null>;
  markUsed(id: string): Promise<void>;
}

const KEY_PREFIX = 'cpk_';

export const hashApiKey = (key: string): string => createHash('sha256').update(key, 'utf8').digest('hex');

/** 256 bits of entropy; lookups are by hash, so the stored value is useless without the key. */
export function generateApiKey(): { key: string; prefix: string; sha256: string } {
  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { key, prefix: key.slice(0, 10), sha256: hashApiKey(key) };
}

export function dbKeyStore(q: Queryable): ApiKeyStore {
  return {
    async findActiveByHash(sha256) {
      const { rows } = await q.query(
        `SELECT k.id, k.name, k.tenant_id, t.slug, k.scopes
           FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
          WHERE k.key_sha256 = $1 AND k.revoked_at IS NULL`,
        [sha256],
      );
      const r = rows[0];
      return r ? { id: String(r.id), name: r.name, tenantId: String(r.tenant_id), tenant: r.slug, scopes: r.scopes as Scope[] } : null;
    },
    async markUsed(id) {
      // At most one write a minute per key.
      await q.query(
        `UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
        [id],
      );
    },
  };
}

export async function createApiKey(q: Queryable, key: { name: string; tenant: string; scopes: readonly Scope[] }) {
  const { key: secret, prefix, sha256 } = generateApiKey();
  const { rows } = await q.query(
    `INSERT INTO api_keys (name, prefix, key_sha256, tenant_id, scopes)
     SELECT $1, $2, $3, t.id, $5 FROM tenants t WHERE t.slug = $4
     RETURNING id`,
    [key.name, prefix, sha256, key.tenant, key.scopes],
  );
  if (!rows[0]) throw new Error(`No tenant "${key.tenant}" (see: pnpm tenants list)`);
  return { id: String(rows[0].id), key: secret, prefix };
}

export async function listApiKeys(q: Queryable) {
  const { rows } = await q.query(
    `SELECT k.id, k.name, k.prefix, k.scopes, t.slug, k.created_at, k.last_used_at, k.revoked_at
       FROM api_keys k JOIN tenants t ON t.id = k.tenant_id ORDER BY k.id`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name as string,
    prefix: r.prefix as string,
    tenant: r.slug as string,
    scopes: r.scopes as Scope[],
    createdAt: r.created_at as Date,
    lastUsedAt: r.last_used_at as Date | null,
    revokedAt: r.revoked_at as Date | null,
  }));
}

export async function revokeApiKey(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
  return (rowCount ?? 0) > 0;
}
