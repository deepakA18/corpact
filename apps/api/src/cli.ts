import { createDb, migrate } from '@corpact/db';
import { DEFAULT_DATABASE_URL } from './app';
import { createApiKey, listApiKeys, revokeApiKey } from './keys';

const USAGE = `usage: pnpm keys <command>
  create <name>   issue a new API key (printed once; only its hash is stored)
  list            show keys: prefix, name, last use, revocation
  revoke <id>     revoke a key immediately`;

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!command || !['create', 'list', 'revoke'].includes(command)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const db = createDb(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  try {
    await migrate(db);
    if (command === 'create') {
      if (!arg) throw new Error('create needs a name, e.g. pnpm keys create demo-dashboard');
      const created = await createApiKey(db, arg);
      console.log(`Created API key #${created.id} "${arg}". Store it now; it cannot be shown again:\n\n  ${created.key}\n`);
    } else if (command === 'list') {
      const keys = await listApiKeys(db);
      if (keys.length === 0) console.log('No API keys.');
      for (const k of keys) {
        const used = k.lastUsedAt ? k.lastUsedAt.toISOString() : 'never';
        console.log(`#${k.id}  ${k.prefix}…  ${k.name}  created ${k.createdAt.toISOString()}  last used ${used}${k.revokedAt ? `  REVOKED ${k.revokedAt.toISOString()}` : ''}`);
      }
    } else {
      if (!arg || !/^\d+$/.test(arg)) throw new Error('revoke needs a numeric key id (see: pnpm keys list)');
      if (await revokeApiKey(db, arg)) console.log(`Revoked key #${arg}`);
      else {
        console.error(`No active key #${arg}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
