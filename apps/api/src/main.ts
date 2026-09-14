import { createDb } from '@corpact/db';
import { DEFAULT_DATABASE_URL, buildApp } from './app';
import { dbAccessStore } from './access';
import { dbKeyStore } from './keys';

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  return n;
}

const db = createDb(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
const app = await buildApp({
  db,
  keys: dbKeyStore(db),
  access: dbAccessStore(db),
  rateLimitPerMinute: positiveInt('RATE_LIMIT_PER_MINUTE', 120),
  authFailuresPerMinute: positiveInt('AUTH_FAILURES_PER_MINUTE', 20),
  corsOrigin: process.env.CORS_ORIGIN,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => db.end());
  });
}

await app.listen({ port: positiveInt('PORT', 4000), host: process.env.HOST ?? '127.0.0.1' });
