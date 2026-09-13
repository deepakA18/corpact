import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '@corpact/db';

export interface ApiKeyIdentity {
  id: string;
  name: string;
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
      const { rows } = await q.query('SELECT id, name FROM api_keys WHERE key_sha256 = $1 AND revoked_at IS NULL', [sha256]);
      return rows[0] ? { id: String(rows[0].id), name: rows[0].name as string } : null;
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

export async function createApiKey(q: Queryable, name: string) {
  const { key, prefix, sha256 } = generateApiKey();
  const { rows } = await q.query('INSERT INTO api_keys (name, prefix, key_sha256) VALUES ($1, $2, $3) RETURNING id', [name, prefix, sha256]);
  return { id: String(rows[0].id), key, prefix };
}

export async function listApiKeys(q: Queryable) {
  const { rows } = await q.query('SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys ORDER BY id');
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name as string,
    prefix: r.prefix as string,
    createdAt: r.created_at as Date,
    lastUsedAt: r.last_used_at as Date | null,
    revokedAt: r.revoked_at as Date | null,
  }));
}

export async function revokeApiKey(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
  return (rowCount ?? 0) > 0;
}
