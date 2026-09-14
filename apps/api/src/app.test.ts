import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { schemas } from '@corpact/client';
import type { Db, MonitoringSnapshot } from '@corpact/db';
import { bitsFromFloat64 } from '@corpact/solana';
import type { AccessStore, Scope } from './access';
import { buildApp, type AppOptions } from './app';
import { generateApiKey, hashApiKey, type ApiKeyStore } from './keys';

const OWNER = '6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U';
const OTHER = '9Eis2fKZpAcZyVSbDdnuBZJ2f74SkSjAC7dx1GsAhNwz';
const KOX = 'XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ';
const FULL_KEY = 'cpk_test_full_access_key_for_unit_tests';
const READ_KEY = 'cpk_test_read_only_key_for_unit_tests';
const OPS_KEY = 'cpk_test_operations_key_for_unit_tests';
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
  interpretation_revision: 2,
  last_corrected_at: new Date('2026-09-13T20:00:00Z'),
};

const journalRow = {
  id: '5',
  owner: OWNER,
  mint: KOX,
  multiplier_version_id: '3',
  entry_type: 'reversal',
  kind: 'dividend',
  effective_unix: '1781481300',
  quantity_num: '9059763073',
  quantity_den: '100000000000',
  split_factor_num: null,
  split_factor_den: null,
  usd: '7.4851762504',
  valuation: 'issuer_net_cash',
  action_match_id: '9',
  issuer_event_id: 'ee3e95e7-4509-499c-a090-4f5c91438ea5',
  issuer_revision: 1,
  reverses_id: '4',
  change_reason: 'issuer_correction',
  change_detail: 'dividend per issuer action ee3e95e7 revision 1 → dividend per issuer action ee3e95e7 revision 2',
  recorded_at: new Date('2026-09-13T20:00:00Z'),
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
          : sql.includes('FROM position_quantity_samples')
            ? [{ effective_unix: '1761239067', quantity_num: '1990144560', quantity_den: '100000000' }]
          : sql.includes("FROM income_entries WHERE position_epoch_id = $1 AND kind = 'dividend'")
            ? [{ effective_unix: '1781481300', quantity_num: '9059763073', quantity_den: '100000000000', usd: '7.4851762504' }]
          : sql.includes("FROM income_entries WHERE position_epoch_id = $1 AND kind = 'split'")
            ? []
          : sql.includes('FROM multiplier_versions v JOIN action_matches')
            ? [{ effective_unix: '1781481300', classification: 'dividend', net_cash_per_share: '0.371', split_factor_num: null, split_factor_den: null }]
          : sql.includes('FROM sync_cursors')
            ? [{ state: { knownFrom: { unixTime: '1759353351' } } }]
          : sql.includes('FROM ledger_journal')
            ? [journalRow]
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
        : hash === hashApiKey(OPS_KEY)
          ? { id: '3', name: 'ops', tenantId: '7', tenant: 'acme', scopes: ['ops:read'] }
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
      expect.arrayContaining([
        '/v1/assets', '/v1/portfolio', '/v1/income', '/v1/income/{id}', '/v1/journal', '/v1/wallets', '/v1/wallets/sync', '/v1/wallets/{owner}/status',
        '/v1/yield', '/v1/export', '/v1/ops/status', '/v1/ops/metrics',
      ]),
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
    [`/v1/journal?owner=${OTHER}`],
    [`/v1/yield?owner=${OTHER}`],
    [`/v1/export?owner=${OTHER}`],
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
    ['GET', `/v1/journal?owner=${OWNER}`, undefined, schemas.journalResponse],
    ['GET', `/v1/yield?owner=${OWNER}`, undefined, schemas.yieldResponse],
    ['POST', '/v1/wallets/sync', { owner: OTHER }, schemas.syncRequestResponse],
  ] as const;

  it.each(cases)('%s %s', async (method, url, payload, schema) => {
    const res = await (await app()).inject({ method, url, headers: full, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBeLessThan(300);
    const validate = ajv.compile(schema);
    const body = res.json();
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });

  it('exposes corrections on income entries and the full history on event detail', async () => {
    const api = await app();
    const list = (await api.inject({ url: `/v1/income?owner=${OWNER}`, headers: full })).json();
    expect(list.entries[0]).toMatchObject({ revision: 2, correctedAt: '2026-09-13T20:00:00.000Z' });
    const detail = (await api.inject({ url: `/v1/income/10?owner=${OWNER}`, headers: full })).json();
    expect(detail.history).toEqual([
      expect.objectContaining({ entryType: 'reversal', reversesId: '4', changeReason: 'issuer_correction', usd: '7.4851762504' }),
    ]);
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

describe('API yield and export', () => {
  it('reports share yield over the covered part of each window, marking windows that start before coverage', async () => {
    const body = (await (await app()).inject({ url: `/v1/yield?owner=${OWNER}`, headers: readOnly })).json();
    const [kox] = body.positions;
    const byWindow = Object.fromEntries(kox.windows.map((w: { window: string }) => [w.window, w]));
    expect(Object.keys(byWindow)).toEqual(['trailing_30d', 'trailing_365d', 'tracked']);
    // 0.09059763073 dividend shares over 19.9014456 held since coverage began.
    expect(byWindow.trailing_365d).toMatchObject({ partial: true, coveredStart: '2025-10-23T17:04:27.000Z', valuedDividends: 1, unvaluedDividends: 0 });
    expect(byWindow.trailing_365d.shareYield).toMatch(/^0\.0045/);
    expect(byWindow.trailing_30d).toMatchObject({ partial: false, valuedDividends: 0, incomeUsd: '0' });
    expect(kox.trailingDistribution).toMatchObject({ netPerShare: '0.371', distributions: 1, missingNetCash: 0, partial: true });
    expect(kox.distributionYield.value).toBeNull();
  });

  it('exports the journal as CSV with confidence fields and a download filename', async () => {
    const res = await (await app()).inject({ url: `/v1/export?owner=${OWNER}`, headers: readOnly });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="corpact-journal-6kn8Vj9Y-\d{4}-\d{2}-\d{2}\.csv"$/);
    const [header, row, trailer] = res.body.split('\r\n');
    expect(header!.split(',').slice(0, 3)).toEqual(['recorded_at', 'entry_type', 'sign']);
    expect(header).toContain('position_reconciled');
    expect(row).toMatch(/^2026-09-13T20:00:00\.000Z,reversal,-1,6kn8Vj9Y/);
    // Exact values for reconciliation, then spreadsheet-friendly ones.
    expect(row).toContain(',0.09059763073,0.09059763,,7.4851762504,7.49,issuer_net_cash,');
    expect(row).toContain('issuer_correction');
    expect(trailer).toBe('');
  });

  it('exports current income entries on request and rejects unknown datasets', async () => {
    const api = await app();
    const income = await api.inject({ url: `/v1/export?owner=${OWNER}&dataset=income`, headers: readOnly });
    expect(income.statusCode).toBe(200);
    const [header, row] = income.body.split('\r\n');
    expect(header).toMatch(/^effective_at,symbol,mint,kind,quantity,quantity_display,split_factor,usd,usd_rounded,/);
    expect(row).toContain(',KOx,');
    expect(row).toContain(',0.09059763073,0.09059763,,7.4851762504,7.49,');
    expect((await api.inject({ url: `/v1/export?owner=${OWNER}&dataset=prices`, headers: readOnly })).statusCode).toBe(400);
  });
});

describe('API operations endpoints', () => {
  const snapshot: MonitoringSnapshot = {
    nowUnix: 1_789_324_000,
    workers: [{ workerId: 'worker-1', lastSeenUnix: 1_789_323_990, mintPollSeconds: 45, rpcRequests: 12, rpcRetries: 1, rpcFailures: 0 }],
    lastMintPoll: { polledUnix: 1_789_323_980, clockUnix: 1_789_323_970, slot: '446774795', mints: 5 },
    overdueActivations: 0,
    pendingOverdueJobs: 0,
    failedJobs24h: 0,
    unreconciledPositions: 1,
    partialPositions: 2,
    failedWalletSyncs: 0,
    mintsWithTimelineGaps: 0,
    issuerFeed: { source: 'fixtures', lastIngestedUnix: 1_789_000_000 },
  };
  const ops = { authorization: `Bearer ${OPS_KEY}` };
  const opsApp = () => app({ collectMonitoring: async () => snapshot });

  it('requires the ops:read scope, which grants no ledger access', async () => {
    const api = await opsApp();
    expect((await api.inject({ url: '/v1/ops/status', headers: full })).json().code).toBe('missing_scope');
    expect((await api.inject({ url: `/v1/portfolio?owner=${OWNER}`, headers: ops })).statusCode).toBe(403);
  });

  it('grades checks against thresholds and reports the worst status', async () => {
    const res = await (await opsApp()).inject({ url: '/v1/ops/status', headers: ops });
    const body = res.json();
    const validate = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schemas.opsStatusResponse);
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    expect(body.status).toBe('critical');
    const byName = Object.fromEntries(body.checks.map((c: { name: string }) => [c.name, c]));
    expect(byName.balance_reconciliation).toMatchObject({ status: 'critical', value: 1 });
    expect(byName.worker_heartbeat).toMatchObject({ status: 'ok', value: 10 });
    expect(byName.issuer_feed.status).toBe('ok');
  });

  it('serves Prometheus metrics', async () => {
    const res = await (await opsApp()).inject({ url: '/v1/ops/metrics', headers: ops });
    expect(res.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(res.body).toContain('# TYPE corpact_check_status gauge');
    expect(res.body).toContain('corpact_check_status{check="balance_reconciliation"} 2');
    expect(res.body).toContain('corpact_rpc_requests_total{worker="worker-1"} 12');
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
