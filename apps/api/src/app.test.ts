import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { schemas } from '@corpact/client';
import type { Db } from '@corpact/db';
import { bitsFromFloat64 } from '@corpact/solana';
import type { AccessStore, Scope } from './access';
import { buildApp, type AppOptions } from './app';
import { generateApiKey, hashApiKey, type ApiKeyStore } from './keys';

const OWNER = '6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U';
const OTHER = '9Eis2fKZpAcZyVSbDdnuBZJ2f74SkSjAC7dx1GsAhNwz';
const KOX = 'XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ';
const FULL_KEY = 'cpk_test_full_access_key_for_unit_tests';
const READ_KEY = 'cpk_test_read_only_key_for_unit_tests';
const full = { authorization: `Bearer ${FULL_KEY}` };
const readOnly = { authorization: `Bearer ${READ_KEY}` };

const syncRow = {
  owner: OWNER,
  status: 'complete',
  requested_at: new Date('2026-09-13T18:21:56Z'),
  started_at: new Date('2026-09-13T18:46:57Z'),
  finished_at: new Date('2026-09-13T18:47:02Z'),
  as_of_slot: '446774795',
  as_of_unix: '1789323946',
  transactions_fetched: 40,
  gaps: [],
  error: null,
  progress: {},
};

// Recorded KOx position: 19.9014456 raw tokens, floor 20.0076646, three verified dividends.
const positionRow = {
  id: '1',
  owner: OWNER,
  mint: KOX,
  epoch: 1,
  status: 'complete',
  coverage_start_unix: '1761239067',
  coverage_start_slot: '372000000',
  coverage_end_unix: '1789323946',
  coverage_end_slot: '446774795',
  gaps: [],
  raw_balance: '1990144560',
  decimals: 8,
  multiplier_bits: bitsFromFloat64(1.0183317967386898),
  floor_num: '2000766460',
  floor_den: '100000000',
  conversion_disabled_reasons: ['Conversion is not enabled in this release'],
  replay_complete: true,
  reconciled: true,
  ledger_version: 'ledger-v1',
  computed_at: new Date('2026-09-13T18:47:02Z'),
  symbol: 'KOx',
  name: null,
  dividend_count: 3,
  unvalued_count: 0,
  unclassified_count: 0,
  income_usd: '22.0774775216',
};

const incomeRow = {
  id: '10',
  kind: 'dividend',
  effective_unix: '1781481300',
  quantity_num: '9059763073',
  quantity_den: '100000000000',
  split_factor_num: null,
  split_factor_den: null,
  usd: '7.4851762504',
  valuation: 'issuer_net_cash',
  warnings: [],
  reasons: [],
  mint: KOX,
  symbol: 'KOx',
  decimals: 8,
};

const detailRow = {
  ...incomeRow,
  owner: OWNER,
  update_signature: '2reEfzuS6mmcExampleSignature',
  observed_slot: '400000000',
  observed_instruction_path: [1],
  scheduled_unix: '1781481300',
  version_effective_unix: '1781481300',
  immediate: false,
  old_multiplier_bits: bitsFromFloat64(1.013779482672994),
  new_multiplier_bits: bitsFromFloat64(1.0183317967386898),
  old_multiplier_exact: '1.0137794826729940',
  new_multiplier_exact: '1.0183317967386898',
  version_status: 'active',
  classifier_version: 'classify-v2',
  classification: 'dividend',
  external_id: 'ee3e95e7-4509-499c-a090-4f5c91438ea5',
  revision: 1,
  net_cash_per_share: '0.357',
  match_reasons: [],
  match_warnings: [],
  action_payload: { eventId: 'ee3e95e7-4509-499c-a090-4f5c91438ea5', symbol: 'KOx', type: 'CashDividend' },
  action_source: 'fixtures',
  evidence_sha256: 'ab'.repeat(32),
};

const assetRow = { mint: KOX, symbol: 'KOx', name: null, decimals: 8, registry_source: 'fixtures', verification_error: null, verified_slot: '446769450' };

/** Answers the API's queries from canned rows; anything unexpected fails loudly. */
async function fakeQuery(sql: string) {
  const text = sql.trim();
  const rows =
    text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK'
      ? []
      : sql.includes('INSERT INTO wallet_syncs')
        ? [{ status: 'queued' }]
        : sql.includes('INSERT INTO jobs_outbox')
          ? [{}]
          : sql.includes('JOIN multiplier_versions')
            ? [detailRow]
            : sql.includes('ORDER BY e.effective_unix')
              ? [incomeRow]
              : sql.includes('FROM position_epochs p JOIN assets')
                ? [positionRow]
                : sql.includes('FROM wallet_syncs')
                  ? [syncRow]
                  : sql.includes('FROM assets ORDER BY symbol')
                    ? [assetRow]
                    : text === 'SELECT 1'
                      ? [{ '?column?': 1 }]
                      : null;
  if (rows === null) throw new Error(`Unexpected query in test: ${sql.slice(0, 80)}`);
  return { rows, rowCount: rows.length };
}

const fakeDb = {
  query: fakeQuery,
  connect: async () => ({ query: fakeQuery, release: () => {} }),
} as unknown as Db;

const ALL: Scope[] = ['assets:read', 'ledger:read', 'wallets:sync'];

const keyStore: ApiKeyStore = {
  findActiveByHash: async (hash) =>
    hash === hashApiKey(FULL_KEY)
      ? { id: '1', name: 'full', tenantId: '7', tenant: 'acme', scopes: ALL }
      : hash === hashApiKey(READ_KEY)
        ? { id: '2', name: 'read', tenantId: '7', tenant: 'acme', scopes: ['assets:read', 'ledger:read'] }
        : null,
  markUsed: async () => {},
};

function memoryAccess(registered: string[] = [OWNER], maxWallets = 10): AccessStore {
  const wallets = new Map(registered.map((owner) => [owner, new Date('2026-09-13T18:00:00Z')]));
  return {
    isRegistered: async (_tenant, owner) => wallets.has(owner),
    register: async (_tenant, owner) => {
      if (wallets.has(owner)) return 'already_registered';
      if (wallets.size >= maxWallets) return 'quota_exceeded';
      wallets.set(owner, new Date());
      return 'registered';
    },
    list: async () => ({ tenant: 'acme', maxWallets, wallets: [...wallets].map(([owner, addedAt]) => ({ owner, addedAt })) }),
  };
}

const app = (overrides: Partial<AppOptions> = {}) =>
  buildApp({ db: fakeDb, keys: keyStore, access: memoryAccess(), rateLimitPerMinute: 100, authFailuresPerMinute: 100, ...overrides });

describe('API authentication', () => {
  it('serves health and the OpenAPI document without a key', async () => {
    const api = await app();
    expect((await api.inject({ url: '/v1/health' })).json()).toEqual({ ok: true });
    const spec = (await api.inject({ url: '/v1/openapi.json' })).json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.components.securitySchemes.apiKey).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/v1/assets', '/v1/portfolio', '/v1/income', '/v1/income/{id}', '/v1/wallets', '/v1/wallets/sync', '/v1/wallets/{owner}/status']),
    );
    expect(spec.paths['/v1/health'].get.security).toEqual([]);
  });

  it('rejects missing and unknown keys', async () => {
    const api = await app();
    const missing = await api.inject({ url: '/v1/assets' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error).toMatch(/Missing API key/);
    const wrong = await api.inject({ url: '/v1/assets', headers: { authorization: 'Bearer cpk_not_a_real_key' } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toMatch(/Invalid or revoked/);
  });

  it('accepts a valid key as a bearer token or x-api-key header', async () => {
    const api = await app();
    expect((await api.inject({ url: '/v1/assets', headers: full })).statusCode).toBe(200);
    expect((await api.inject({ url: '/v1/assets', headers: { 'x-api-key': FULL_KEY } })).statusCode).toBe(200);
  });

  it('stops accepting key guesses from an address after repeated failures, even for a valid key', async () => {
    const api = await app({ authFailuresPerMinute: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await api.inject({ url: '/v1/assets', headers: { authorization: `Bearer cpk_guess_${i}` } })).statusCode).toBe(401);
    }
    expect((await api.inject({ url: '/v1/assets', headers: full })).statusCode).toBe(429);
  });
});

describe('API scopes and tenancy', () => {
  it('refuses a route whose scope the key lacks', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/v1/wallets/sync', headers: readOnly, payload: { owner: OWNER } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'This API key lacks the "wallets:sync" scope', code: 'missing_scope' });
  });

  it.each([
    [`/v1/portfolio?owner=${OTHER}`],
    [`/v1/income?owner=${OTHER}`],
    [`/v1/income/10?owner=${OTHER}`],
    [`/v1/wallets/${OTHER}/status`],
  ])('answers 404 for a wallet the tenant has not registered: %s', async (url) => {
    const res = await (await app()).inject({ url, headers: full });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('wallet_not_registered');
  });

  it('registers a wallet on sync, after which the tenant can read it', async () => {
    const api = await app();
    const sync = await api.inject({ method: 'POST', url: '/v1/wallets/sync', headers: full, payload: { owner: OTHER } });
    expect(sync.statusCode).toBe(202);
    expect(sync.json()).toEqual({ owner: OTHER, registration: 'registered', status: 'queued', job: 'enqueued' });
    expect((await api.inject({ url: `/v1/portfolio?owner=${OTHER}`, headers: full })).statusCode).toBe(200);
    const again = await api.inject({ method: 'POST', url: '/v1/wallets/sync', headers: full, payload: { owner: OTHER } });
    expect(again.json().registration).toBe('already_registered');
  });

  it('enforces the tenant wallet quota', async () => {
    const res = await (await app({ access: memoryAccess([OWNER], 1) })).inject({
      method: 'POST',
      url: '/v1/wallets/sync',
      headers: full,
      payload: { owner: OTHER },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('wallet_quota_exceeded');
  });
});

describe('API limits and validation', () => {
  it('rate-limits per key with a 429 and retry headers', async () => {
    const api = await app({ rateLimitPerMinute: 2 });
    expect((await api.inject({ url: '/v1/assets', headers: full })).statusCode).toBe(200);
    expect((await api.inject({ url: '/v1/assets', headers: full })).statusCode).toBe(200);
    const limited = await api.inject({ url: '/v1/assets', headers: full });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatch(/Rate limit of 2 requests per minute/);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('rejects malformed input before touching the ledger', async () => {
    const api = await app();
    expect((await api.inject({ url: '/v1/portfolio?owner=not-an-address', headers: full })).statusCode).toBe(400);
    expect((await api.inject({ url: `/v1/income?owner=${OWNER}&limit=500`, headers: full })).statusCode).toBe(400);
    expect((await api.inject({ url: `/v1/income/abc?owner=${OWNER}`, headers: full })).statusCode).toBe(400);
  });

  it('marks every response as uncacheable', async () => {
    expect((await (await app()).inject({ url: '/v1/health' })).headers['cache-control']).toBe('no-store');
  });
});

describe('API responses match the published contract', () => {
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  const cases = [
    ['GET', '/v1/assets', undefined, schemas.assetsResponse],
    ['GET', '/v1/wallets', undefined, schemas.walletsResponse],
    ['GET', `/v1/wallets/${OWNER}/status`, undefined, schemas.syncStatusResponse],
    ['GET', `/v1/portfolio?owner=${OWNER}`, undefined, schemas.portfolioResponse],
    ['GET', `/v1/income?owner=${OWNER}`, undefined, schemas.incomeResponse],
    ['GET', `/v1/income/10?owner=${OWNER}`, undefined, schemas.incomeDetail],
    ['POST', '/v1/wallets/sync', { owner: OTHER }, schemas.syncRequestResponse],
  ] as const;

  it.each(cases)('%s %s', async (method, url, payload, schema) => {
    const res = await (await app()).inject({ method, url, headers: full, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBeLessThan(300);
    const validate = ajv.compile(schema);
    const body = res.json();
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });

  it('error bodies match the error schema', async () => {
    const validate = ajv.compile(schemas.errorResponse);
    const res = await (await app()).inject({ url: `/v1/portfolio?owner=${OTHER}`, headers: full });
    expect(validate(res.json()), JSON.stringify(validate.errors)).toBe(true);
  });

  it('derives protected and convertible exposure from the stored floor, rounding toward zero', async () => {
    const body = (await (await app()).inject({ url: `/v1/portfolio?owner=${OWNER}`, headers: full })).json();
    // The fixture floor is the recorded KOx floor rounded to 8 places, so availability is 1e-8 above the live 0.25861024.
    expect(body.positions[0]).toMatchObject({ protectedQuantity: '20.00766460', availableQuantity: '0.25861025', reconciled: true });
  });
});

describe('API keys', () => {
  it('generates high-entropy keys and stores only a hash', () => {
    const { key, prefix, sha256 } = generateApiKey();
    expect(key).toMatch(/^cpk_[A-Za-z0-9_-]{43}$/);
    expect(prefix).toBe(key.slice(0, 10));
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256).not.toContain(key.slice(4));
    expect(hashApiKey(key)).toBe(sha256);
  });
});
