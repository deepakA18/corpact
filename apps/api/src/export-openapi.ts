import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '@corpact/db';
import { buildApp } from './app';

/** Writes the published OpenAPI document; `--check` fails if the committed copy is stale. */
const OUT = join(import.meta.dirname, '../../../packages/client/openapi.json');

const offlineDb = {
  query: async () => {
    throw new Error('The OpenAPI export never touches a database');
  },
} as unknown as Db;

const app = await buildApp({
  db: offlineDb,
  keys: { findActiveByHash: async () => null, markUsed: async () => {} },
  access: {
    isRegistered: async () => false,
    register: async () => 'quota_exceeded',
    list: async () => ({ tenant: 'offline', maxWallets: 1, wallets: [] }),
  },
  rateLimitPerMinute: 1,
  authFailuresPerMinute: 1,
});
await app.ready();
const spec = `${JSON.stringify(app.swagger(), null, 2)}\n`;
await app.close();

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current === spec) {
    console.log('OpenAPI spec is up to date');
  } else {
    console.error(`${OUT} is out of date — run: pnpm --filter @corpact/api openapi:export`);
    process.exitCode = 1;
  }
} else {
  writeFileSync(OUT, spec);
  console.log(`Wrote ${OUT}`);
}
