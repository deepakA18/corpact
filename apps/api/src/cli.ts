import { createDb, migrate } from '@corpact/db';
import { DEFAULT_KEY_SCOPES, createTenant, listTenants, parseScopes } from './access';
import { DEFAULT_DATABASE_URL } from './app';
import { createApiKey, listApiKeys, revokeApiKey } from './keys';

const USAGE = `usage:
  pnpm tenants create <slug> <name> [--max-wallets N]
  pnpm tenants list
  pnpm keys create <name> --tenant <slug> [--scopes ${DEFAULT_KEY_SCOPES.join(',')}]
  pnpm keys list
  pnpm keys revoke <id>

scopes: assets:read, ledger:read, wallets:sync (new keys default to read-only)`;

/** Splits `a b --flag value` into positionals and flags. */
function parseArgs(args: string[]) {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      flags.set(arg.slice(2), value);
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function main() {
  const [group, command, ...rest] = process.argv.slice(2);
  const known = (group === 'tenants' && ['create', 'list'].includes(command ?? '')) || (group === 'keys' && ['create', 'list', 'revoke'].includes(command ?? ''));
  if (!known) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const { positional, flags } = parseArgs(rest);
  const db = createDb(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  try {
    await migrate(db);
    if (group === 'tenants' && command === 'create') {
      const [slug, ...nameParts] = positional;
      if (!slug || nameParts.length === 0) throw new Error('tenants create needs a slug and a name, e.g. pnpm tenants create acme "Acme Exchange"');
      const maxWallets = flags.has('max-wallets') ? Number(flags.get('max-wallets')) : undefined;
      if (maxWallets !== undefined && (!Number.isInteger(maxWallets) || maxWallets <= 0)) throw new Error('--max-wallets must be a positive integer');
      const { id } = await createTenant(db, { slug, name: nameParts.join(' '), maxWallets });
      console.log(`Created tenant #${id} "${slug}"${maxWallets ? ` (max ${maxWallets} wallets)` : ''}`);
    } else if (group === 'tenants') {
      const tenants = await listTenants(db);
      if (tenants.length === 0) console.log('No tenants.');
      for (const t of tenants) console.log(`#${t.id}  ${t.slug}  "${t.name}"  wallets ${t.wallets}/${t.maxWallets}  active keys ${t.activeKeys}`);
    } else if (command === 'create') {
      const name = positional.join(' ');
      const tenant = flags.get('tenant');
      if (!name || !tenant) throw new Error('keys create needs a name and --tenant <slug>');
      const scopes = flags.has('scopes') ? parseScopes(flags.get('scopes')!) : [...DEFAULT_KEY_SCOPES];
      const created = await createApiKey(db, { name, tenant, scopes });
      console.log(`Created API key #${created.id} "${name}" for ${tenant} with ${scopes.join(', ')}.`);
      console.log(`Store it now; it cannot be shown again:\n\n  ${created.key}\n`);
    } else if (command === 'list') {
      const keys = await listApiKeys(db);
      if (keys.length === 0) console.log('No API keys.');
      for (const k of keys) {
        const used = k.lastUsedAt ? k.lastUsedAt.toISOString() : 'never';
        console.log(`#${k.id}  ${k.prefix}…  ${k.tenant}  ${k.name}  [${k.scopes.join(', ')}]  last used ${used}${k.revokedAt ? `  REVOKED ${k.revokedAt.toISOString()}` : ''}`);
      }
    } else {
      const [id] = positional;
      if (!id || !/^\d+$/.test(id)) throw new Error('keys revoke needs a numeric key id (see: pnpm keys list)');
      if (await revokeApiKey(db, id)) console.log(`Revoked key #${id}`);
      else {
        console.error(`No active key #${id}`);
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
