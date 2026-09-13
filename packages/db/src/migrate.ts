import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withTransaction, type Db } from './pool';

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');
const MIGRATION_LOCK = 7_272_741;

/** Apply pending SQL migrations in filename order, each in its own transaction. Returns the names applied. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];
  for (const name of files) {
    const didApply = await withTransaction(db, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (rowCount) return false;
      await client.query(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      return true;
    });
    if (didApply) applied.push(name);
  }
  return applied;
}
