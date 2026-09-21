import { createTenant, dbAccessStore } from '@corpact/api/access';
import { buildApp } from '@corpact/api/app';
import { createApiKey, dbKeyStore } from '@corpact/api/keys';
import { createDb } from '@corpact/db';

/**
 * The real API (Fastify app, database key store, tenant registration) over the demo database,
 * called in-process: what an integrating customer would see.
 */
export async function createDemoApi(databaseUrl: string) {
  const db = createDb(databaseUrl);
  // An idle connection dropped by the server (e.g. Postgres shutting down) must fail the run through the normal
  // path, which stops the local network - not crash the process and leave the node running.
  db.on('error', (error) => console.error(`Demo database connection lost: ${error.message}`));
  const app = await buildApp({
    db,
    keys: dbKeyStore(db),
    access: dbAccessStore(db),
    rateLimitPerMinute: 100_000,
    authFailuresPerMinute: 100,
    logger: false,
  });
  const tenant = await createTenant(db, { slug: 'demo', name: 'Synthetic demo' });
  const { key } = await createApiKey(db, { name: 'demo-ledger', tenant: 'demo', scopes: ['assets:read', 'ledger:read'] });
  const { key: opsKey } = await createApiKey(db, { name: 'demo-ops', tenant: 'demo', scopes: ['ops:read'] });
  const access = dbAccessStore(db);

  async function request(url: string, as: 'ledger' | 'ops' = 'ledger') {
    const res = await app.inject({ url, headers: { authorization: `Bearer ${as === 'ops' ? opsKey : key}` } });
    if (res.statusCode !== 200) throw new Error(`GET ${url} answered ${res.statusCode}: ${res.body.slice(0, 300)}`);
    return res;
  }

  return {
    db,
    register: (owner: string) => access.register(tenant.id, owner),
    request,
    get: async <T>(url: string, as: 'ledger' | 'ops' = 'ledger'): Promise<T> => (await request(url, as)).json() as T,
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}

export type DemoApi = Awaited<ReturnType<typeof createDemoApi>>;
