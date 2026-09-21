import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTenant, dbAccessStore } from '@corpact/api/access';
import { buildApp } from '@corpact/api/app';
import { createApiKey, dbKeyStore } from '@corpact/api/keys';
import { createDb, verifyIntegrity } from '@corpact/db';
import { Rational } from '@corpact/domain';
import { DEFAULT_ADMIN_DATABASE_URL, REPO_ROOT } from './runner';

/**
 * Reproduces the end-to-end check of the AZNx identity change (docs/findings/corporate-actions-census.md §6) on a
 * real mainnet wallet, from a fresh clone:
 *
 *   pnpm --filter @corpact/demo lineage-check [--owner <address>]
 *
 * Needs SOLANA_RPC_URL (archival; read from the environment or the repo .env). Issuer data comes from the recorded
 * fixtures: no call to the issuer. Everything is written to a scratch database, `corpact_lineage_check`, recreated
 * on each run; the main ledger database is never touched. Output names counts and statuses, never the wallet.
 */

const AZNX_MINT = 'Xs3ZFkPYT2BN7qBMqf1j1bfTeTm1rFzEFSsQ1z3wAKU';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const CONVERSION_UNIX = Date.parse('2026-02-02T22:00:00Z') / 1000;
const DATABASE = 'corpact_lineage_check';
const WORKER_DIR = join(REPO_ROOT, 'apps/worker');

function config() {
  const file = join(REPO_ROOT, '.env');
  const fromFile = existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => /^[A-Z_]+=/.test(l))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
      )
    : {};
  const get = (name: string) => process.env[name] ?? fromFile[name];
  const rpcUrl = get('SOLANA_RPC_URL');
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL is required (an archival mainnet RPC), in the environment or the repo .env');
  const ownerFlag = process.argv.indexOf('--owner');
  return {
    rpcUrl,
    owner: ownerFlag > 0 ? process.argv[ownerFlag + 1] : get('LINEAGE_CHECK_OWNER'),
    rpcMaxConcurrency: get('RPC_MAX_CONCURRENCY') ?? '4',
    rpcMinIntervalMs: get('RPC_MIN_INTERVAL_MS') ?? '100',
    walletMaxSignatures: get('WALLET_MAX_SIGNATURES') ?? '150',
    adminUrl: get('DEMO_ADMIN_DATABASE_URL') ?? DEFAULT_ADMIN_DATABASE_URL,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (res.status === 429 || res.status >= 500) {
      await sleep(500 * attempt);
      continue;
    }
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  }
  throw new Error(`${method}: provider kept refusing`);
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = `1${s}`;
  }
  return s;
}

/** An AZNx holder whose AZNx account was active before the conversion, preferring the smallest wallet history. */
async function findHolder(rpcUrl: string): Promise<string> {
  const accounts = await rpc<Array<{ pubkey: string; account: { data: [string, string] } }>>(rpcUrl, 'getProgramAccounts', [
    TOKEN_2022,
    { encoding: 'base64', dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: AZNX_MINT } }] },
  ]);
  const holders = accounts
    .map((a) => {
      const data = Buffer.from(a.account.data[0], 'base64');
      return { account: a.pubkey, owner: base58(data.subarray(0, 32)), raw: data.readBigUInt64LE(32) };
    })
    .filter((h) => h.raw > 0n)
    .toSorted((a, b) => (a.raw > b.raw ? -1 : 1));
  const candidates: Array<{ owner: string; ownerTxs: number }> = [];
  for (const h of holders.slice(0, 120)) {
    const sigs = await rpc<Array<{ blockTime: number | null }>>(rpcUrl, 'getSignaturesForAddress', [h.account, { limit: 1000 }]);
    const oldest = sigs.at(-1)?.blockTime;
    if (sigs.length === 0 || sigs.length >= 1000 || oldest == null || oldest >= CONVERSION_UNIX - 86_400) continue;
    const ownerSigs = await rpc<unknown[]>(rpcUrl, 'getSignaturesForAddress', [h.owner, { limit: 1000 }]);
    candidates.push({ owner: h.owner, ownerTxs: ownerSigs.length });
    if (candidates.length >= 5) break;
  }
  const best = candidates.toSorted((a, b) => a.ownerTxs - b.ownerTxs)[0];
  if (!best) throw new Error('No AZNx holder from before the conversion was found among the largest 120 accounts');
  return best.owner;
}

function runWorker(args: readonly string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(WORKER_DIR, 'node_modules/.bin/tsx'), ['src/main.ts', ...args], {
      cwd: WORKER_DIR,
      // Built from scratch: nothing else from the caller's environment reaches the worker.
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${args[0]} exited ${code}: ${stderr.split('\n').slice(-8).join('\n')}`))));
  });
}

async function main() {
  const cfg = config();
  const started = Date.now();
  const step = (text: string) => console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${text}`);

  const admin = new URL(cfg.adminUrl);
  if (!['127.0.0.1', 'localhost'].includes(admin.hostname)) throw new Error('The scratch database must be on a local Postgres');
  const adminDb = createDb(cfg.adminUrl);
  try {
    await adminDb.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await adminDb.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await adminDb.end();
  }
  admin.pathname = `/${DATABASE}`;
  const databaseUrl = admin.toString();

  step(`RPC host ${new URL(cfg.rpcUrl).host}; scratch database ${DATABASE}; issuer source: recorded fixtures`);
  const owner = cfg.owner ?? (await findHolder(cfg.rpcUrl));
  step(cfg.owner ? 'Using the wallet given' : 'Found an AZNx holder from before the conversion');

  const env = {
    DATABASE_URL: databaseUrl,
    SOLANA_RPC_URL: cfg.rpcUrl,
    ISSUER_SOURCE: 'fixtures',
    RPC_MAX_CONCURRENCY: cfg.rpcMaxConcurrency,
    RPC_MIN_INTERVAL_MS: cfg.rpcMinIntervalMs,
    WALLET_MAX_SIGNATURES: cfg.walletMaxSignatures,
    WORKER_ID: 'lineage-check',
  };
  for (const [label, args] of [
    ['migrate', ['migrate']],
    ['verify the registry on chain', ['sync-registry']],
    ['import recorded issuer actions', ['import-issuer-actions']],
    ['sync the wallet (this can take many minutes for a busy wallet)', ['sync-wallet', owner]],
  ] as const) {
    step(label);
    await runWorker(args, env);
  }

  const db = createDb(databaseUrl);
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const expect = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });
  try {
    const match = (
      await db.query(
        `SELECT m.classification, m.action_kind, m.classifier_status, m.from_underlying, m.to_underlying, m.external_id
           FROM action_matches m JOIN multiplier_versions v ON v.id = m.multiplier_version_id
          WHERE v.mint = $1 AND m.superseded_at IS NULL AND m.action_kind = 'identity_change'`,
        [AZNX_MINT],
      )
    ).rows;
    expect(
      'classification',
      match.length === 1 && match[0].classifier_status === 'validated' && match[0].from_underlying === 'NASDAQ:AZN (ADR)' && match[0].to_underlying === 'NYSE:AZN',
      `${match.length} identity-change match(es): ${match.map((m) => `${m.classifier_status}, ${m.from_underlying} → ${m.to_underlying}`).join('; ')}`,
    );

    const identities = (await db.query('SELECT id, underlying_symbol FROM instrument_identities WHERE mint = $1 ORDER BY valid_from', [AZNX_MINT])).rows;
    const links = (
      await db.query(
        `SELECT l.id, l.kind, l.cash_basis_num, l.cash_basis_den, s.basis_num, s.basis_den, s.quantity_factor_num, s.quantity_factor_den
           FROM lineage_links l JOIN lineage_successors s ON s.link_id = l.id JOIN instrument_identities f ON f.id = l.from_identity_id
          WHERE f.mint = $1`,
        [AZNX_MINT],
      )
    ).rows;
    const r = (n: string, d: string) => Rational.of(BigInt(n), BigInt(d));
    const link = links[0];
    expect(
      'lineage rows',
      identities.length === 2 &&
        links.length === 1 &&
        r(link.cash_basis_num, link.cash_basis_den).isZero() &&
        r(link.basis_num, link.basis_den).eq(Rational.ONE) &&
        r(link.quantity_factor_num, link.quantity_factor_den).eq(Rational.of(1n, 2n)),
      `${identities.length} identities (${identities.map((i) => i.underlying_symbol).join(' → ')}), ${links.length} link(s); successor basis ${link ? `${link.basis_num}/${link.basis_den}` : '-'}, cash basis ${link ? `${link.cash_basis_num}/${link.cash_basis_den}` : '-'}, factor ${link ? `${link.quantity_factor_num}/${link.quantity_factor_den}` : '-'}`,
    );

    const position = (await db.query('SELECT status, replay_complete, reconciled, gaps FROM position_epochs WHERE owner = $1 AND mint = $2', [owner, AZNX_MINT])).rows[0];
    expect(
      'ledger replay',
      position?.replay_complete === true && position?.reconciled === true,
      position ? `replay complete ${position.replay_complete}, reconciled ${position.reconciled}, status ${position.status} (${(position.gaps as string[]).length} coverage gap(s) across the wallet)` : 'no AZNx position',
    );
    const journal = (
      await db.query(`SELECT entry_type FROM ledger_journal WHERE owner = $1 AND mint = $2 AND action_kind = 'identity_change'`, [owner, AZNX_MINT])
    ).rows;
    expect('journal', journal.length === 1 && journal[0].entry_type === 'recognition', `${journal.length} identity-change journal row(s)`);

    // Downstream reads through the real API, in-process.
    const app = await buildApp({ db, keys: dbKeyStore(db), access: dbAccessStore(db), rateLimitPerMinute: 100_000, authFailuresPerMinute: 100 });
    try {
      const tenant = await createTenant(db, { slug: 'lineage-check', name: 'Lineage check' });
      const { key } = await createApiKey(db, { name: 'lineage-check', tenant: 'lineage-check', scopes: ['assets:read', 'ledger:read'] });
      await dbAccessStore(db).register(tenant.id, owner);
      const get = async (url: string) => {
        const res = await app.inject({ url, headers: { authorization: `Bearer ${key}` } });
        if (res.statusCode !== 200) throw new Error(`GET ${url.replace(owner, '<owner>')} answered ${res.statusCode}`);
        return res.json();
      };
      const q = encodeURIComponent(owner);
      const actions: Array<Record<string, any>> = [];
      for (let offset: number | null = 0; offset !== null; ) {
        const page = await get(`/v2/actions?owner=${q}&limit=200&offset=${offset}`);
        actions.push(...page.actions);
        offset = page.nextOffset;
      }
      const action = actions.find((a) => a.mint === AZNX_MINT && a.type === 'identity_change');
      const stored = action
        ? (await db.query(`SELECT stored_payload_sha256 FROM corporate_actions WHERE external_id = $1 AND revision = $2`, [action.evidence.issuerEventId, action.evidence.issuerRevision])).rows[0]
        : undefined;
      expect(
        'API v2 action',
        action?.treatment === 'identity' && action?.validation.status === 'validated' && action?.lifecycle.state === 'activated' && action?.usd === null && action?.evidence.evidenceSha256 === stored?.stored_payload_sha256,
        action ? `${action.type}, ${action.treatment}, ${action.validation.status}, ${action.lifecycle.state}, factor ${action.factor}, evidence hash ${action.evidence.evidenceSha256 === stored?.stored_payload_sha256 ? 'matches the stored payload' : 'DOES NOT match'}` : 'no identity-change action',
      );
      if (action) {
        const detail = await get(`/v2/actions/${action.id}?owner=${q}`);
        expect(
          'API v2 detail',
          detail.lineage?.successors?.[0]?.basisFraction === '1' && detail.lineage?.cashBasisFraction === '0' && detail.lifecycle.inconsistency === null,
          `lifecycle ${detail.lifecycle.steps.map((s: { state: string }) => s.state).join(' → ')}; lineage successor basis ${detail.lineage?.successors?.[0]?.basisFraction ?? '-'}`,
        );
        const v1: Array<Record<string, any>> = (await get(`/v1/income?owner=${q}&limit=200`)).entries;
        const same = v1.find((e) => e.mint === AZNX_MINT && e.effectiveAt === action.effectiveAt);
        expect(
          'API v1 unchanged',
          same?.kind === 'unclassified_adjustment' && same?.splitFactor === null && same?.usd === null,
          same ? `${same.kind}, splitFactor ${same.splitFactor}, reason "${same.reasons[0]}"` : 'entry not in the first v1 page',
        );
      }
      const lineage = await get(`/v2/instruments/${AZNX_MINT}/lineage`);
      expect(
        'API v2 lineage trace',
        lineage.current.length === 1 && lineage.current[0].underlyingSymbol === 'NYSE:AZN' && lineage.current[0].basisFraction === '1' && !lineage.current[0].terminated,
        JSON.stringify(lineage.current),
      );
    } finally {
      await app.close();
    }

    const integrity = await verifyIntegrity(db);
    expect('verify-integrity', integrity.every((i) => i.ok), integrity.map((i) => `${i.ok ? 'PASS' : 'FAIL'} ${i.name}`).join('; '));
  } finally {
    await db.end();
  }

  for (const res of results) console.log(`${res.ok ? 'PASS' : 'FAIL'}  ${res.name}: ${res.detail}`);
  const failed = results.filter((res) => !res.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed in ${Math.round((Date.now() - started) / 1000)}s. Scratch database ${DATABASE} is kept until the next run.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
