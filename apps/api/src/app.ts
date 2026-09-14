import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { positionView, trailingDistributionPerShare, windowMetrics } from '@corpact/accounting';
import { schemas } from '@corpact/client';
import {
  collectSnapshot,
  enqueueJob,
  evaluateChecks,
  readDataset,
  toPrometheus,
  withTransaction,
  type Dataset,
  type Db,
  type MonitoringSnapshot,
} from '@corpact/db';
import { Rational } from '@corpact/domain';
import { float64FromBits, isAddress } from '@corpact/solana';
import type { AccessStore, Scope } from './access';
import { toCsv } from './csv';
import { hashApiKey, type ApiKeyIdentity, type ApiKeyStore } from './keys';
import { HttpError, errors, exact, iso, isoOfDate, ratio, towardZero } from './shared';
import { registerV2 } from './v2';

export const API_VERSION = '0.1.0';
export const DEFAULT_DATABASE_URL = 'postgres://parityfi:parityfi-dev@127.0.0.1:54329/parityfi';

const PUBLIC_ROUTES = new Set(['/v1/health', '/v1/openapi.json']);
const CONVERSION_NOT_ENABLED = 'Conversion is not enabled in this release';
const NO_PRICE_SOURCE = 'No event-time price source is configured; USD values come only from issuer net cash';
const EXPORT_ROW_LIMIT = 50_000;
const DAY = 86_400n;

const YIELD_DEFINITIONS = {
  shareYield:
    'Dividend-attributed shares gained ÷ time-weighted average shares held, in the current split basis. Not annualized. Needs no price; it approximates net dividend yield at the prices the issuer reinvested at. Claimed only for a completely replayed position over a window its coverage fully spans; otherwise null with an excluded reason, while observed income and quantities for the covered part are still reported.',
  trailingNetDistributionPerShare:
    "Sum of issuer-verified net cash per share over the trailing 365 days, normalized to today's split basis. Null with an excluded reason when any distribution lacks issuer net cash or when the observed multiplier history starts inside the window.",
  distributionYield: 'Trailing net distribution per share ÷ current share price. Unavailable: no price source is configured.',
} as const;

const JOURNAL_CSV_COLUMNS = [
  'recorded_at', 'entry_type', 'sign', 'owner', 'symbol', 'mint', 'effective_at', 'kind', 'quantity', 'quantity_display', 'split_factor', 'usd',
  'usd_rounded', 'valuation', 'issuer_event_id', 'issuer_revision', 'journal_id', 'reverses_journal_id', 'change_reason', 'change_detail', 'position_status',
  'position_reconciled', 'coverage_start',
] as const;

const INCOME_CSV_COLUMNS = [
  'effective_at', 'symbol', 'mint', 'kind', 'quantity', 'quantity_display', 'split_factor', 'usd', 'usd_rounded', 'valuation', 'revision', 'corrected_at', 'warnings',
  'reasons', 'position_status', 'position_reconciled', 'coverage_start',
] as const;

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyIdentity;
  }
  interface FastifyContextConfig {
    /** Scope a key must hold to call the route. */
    scope?: Scope;
  }
}

export interface AppOptions {
  db: Db;
  keys: ApiKeyStore;
  access: AccessStore;
  rateLimitPerMinute: number;
  /** Failed key presentations tolerated per client IP per minute before refusing further attempts. */
  authFailuresPerMinute: number;
  /** Only needed when a browser calls the API directly; the demo dashboard goes through its own server. */
  corsOrigin?: string | undefined;
  /** Injectable for tests; defaults to reading the ledger database. */
  collectMonitoring?: (db: Db) => Promise<MonitoringSnapshot>;
  logger?: FastifyServerOptions['logger'];
}

/**
 * API v1 predates the action taxonomy. Kinds v1 never booked — spin-offs and rights (distributions), stock dividends
 * and identity changes — are presented there as unclassified adjustments: no income and nothing convertible, which is
 * true. The treatment is stated in reasons and headline, so v1's kinds and response shape are unchanged. API v2
 * reports the kind itself (docs: API v1 → v2).
 */
type KindRow = Record<string, any>;
export const v1Hidden = (r: KindRow) => r.kind === 'distribution' || r.kind === 'identity_change' || r.action_kind === 'stock_dividend';
const v1Kind = (r: KindRow) => (v1Hidden(r) ? 'unclassified_adjustment' : r.kind);
const v1Result = (classification: string, actionKind: string | null) =>
  v1Hidden({ kind: classification, action_kind: actionKind }) ? 'unclassified' : classification;
const v1SplitFactor = (r: Record<string, any>) => (r.split_factor_num == null || v1Hidden(r) ? null : exact(ratio(r.split_factor_num, r.split_factor_den)));

function distributedPercent(r: Record<string, any>): string | null {
  return r.distributed_fraction_num == null
    ? null
    : Rational.of(BigInt(r.distributed_fraction_num), BigInt(r.distributed_fraction_den)).mul(Rational.of(100n)).toFixed(2);
}

const factorText = (r: Record<string, any>) => (r.split_factor_num == null ? 'by an unknown factor' : `×${ratio(r.split_factor_num, r.split_factor_den).toFixed(6)}`);

function v1Reasons(r: Record<string, any>): string[] {
  if (!v1Hidden(r)) return (r.reasons as string[] | null) ?? [];
  switch (r.action_kind) {
    case 'rights_distribution':
      return [`Rights distribution booked as a basis allocation, not income: ${distributedPercent(r) ?? 'an unknown share'}% of the position's value came from rights sold and reinvested`];
    case 'stock_dividend':
      return [`Stock dividend booked as a quantity adjustment, not income: units ${factorText(r)}, with cost basis spread across them`];
    case 'identity_change':
      return [`Identity change of the underlying booked as a quantity adjustment, not income: units ${factorText(r)}, all cost basis carried over`];
    default:
      return [`Spin-off booked as a basis allocation, not income: ${distributedPercent(r) ?? 'an unknown share'}% of the position's value was distributed and reinvested`];
  }
}

function describeEntry(e: {
  kind: string;
  action: string | null;
  quantityDisplay: string;
  symbol: string;
  usd: string | null;
  warnings: string[];
  reasons: string[];
  distributedPercent?: string | null;
  factor?: string;
}): string {
  if (e.kind === 'distribution' && e.action === 'rights_distribution') {
    return `Your ${e.symbol} position gained ${e.quantityDisplay} units from rights sold and reinvested as principal (${e.distributedPercent ?? 'an unknown share'}% of the position). No income recorded.`;
  }
  if (e.kind === 'distribution') {
    return `Your ${e.symbol} position gained ${e.quantityDisplay} units from a spin-off: the distributed value was reinvested as principal (${e.distributedPercent ?? 'an unknown share'}% of the position). No income recorded.`;
  }
  if (e.kind === 'identity_change') {
    return `Your ${e.symbol} position moved to a new underlying listing: units ${e.factor ?? 'rescaled'} (${e.quantityDisplay}), all cost basis carried over. No income recorded.`;
  }
  if (e.kind === 'split' && e.action === 'stock_dividend') {
    return `Your ${e.symbol} position gained ${e.quantityDisplay} units from a stock dividend (units ${e.factor ?? 'rescaled'}); cost basis is spread across them. No income recorded.`;
  }
  if (e.kind === 'dividend') {
    const value =
      e.usd !== null
        ? `Value from issuer-reported net cash reinvested: $${Rational.fromDecimal(e.usd).toFixed(2)}.`
        : `USD value unavailable${e.warnings[0] ? `: ${e.warnings[0]}` : ''}.`;
    return `Your ${e.symbol} position gained ${e.quantityDisplay} stock-equivalent units from a verified dividend adjustment. ${value} This remains invested in the stock.`;
  }
  if (e.kind === 'split') return 'Stock split applied; no dividend income recorded.';
  return `Balance adjustment detected; classification pending.${e.reasons[0] ? ` ${e.reasons[0]}.` : ''} No income recorded.`;
}

function journalEntryFromRow(r: Record<string, any>) {
  return {
    id: String(r.id),
    recordedAt: r.recorded_at,
    entryType: r.entry_type,
    kind: v1Kind(r),
    effectiveAt: iso(r.effective_unix),
    quantity: exact(Rational.of(BigInt(r.quantity_num), BigInt(r.quantity_den))),
    splitFactor: v1SplitFactor(r),
    usd: r.usd === null ? null : exact(Rational.fromDecimal(r.usd)),
    valuation: r.valuation,
    issuerEventId: r.issuer_event_id,
    issuerRevision: r.issuer_revision,
    reversesId: r.reverses_id === null ? null : String(r.reverses_id),
    changeReason: r.change_reason,
    changeDetail: r.change_detail,
  };
}

function presentedKey(headers: Record<string, string | string[] | undefined>): string | null {
  const auth = headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+\S+$/i.test(auth)) return auth.replace(/^Bearer\s+/i, '');
  const header = headers['x-api-key'];
  return typeof header === 'string' && header.length > 0 ? header : null;
}

/** Counts failed key presentations per IP, so keys cannot be guessed at the rate-limit budget of a valid one. */
function createFailureLimiter(maxPerMinute: number) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    blocked(ip: string): boolean {
      const w = windows.get(ip);
      if (!w) return false;
      if (Date.now() >= w.resetAt) {
        windows.delete(ip);
        return false;
      }
      return w.count >= maxPerMinute;
    },
    record(ip: string): void {
      const now = Date.now();
      if (windows.size > 10_000) {
        for (const [key, w] of windows) if (now >= w.resetAt) windows.delete(key);
      }
      const w = windows.get(ip);
      if (!w || now >= w.resetAt) windows.set(ip, { count: 1, resetAt: now + 60_000 });
      else w.count++;
    },
  };
}

export async function buildApp(options: AppOptions) {
  const { db } = options;
  const app = Fastify({ logger: options.logger ?? false });

  // Serialize responses exactly as built. Schemas document and test the contract; they must never drop a field.
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));

  if (options.corsOrigin) await app.register(cors, { origin: options.corsOrigin });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Corpact API',
        version: API_VERSION,
        description:
          'Corporate-action accounting for tokenized equities on Solana. Quantities, raw amounts, slots and USD values are decimal strings; null means unknown, never zero.',
      },
      components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'Corpact API key (cpk_…)' } } },
      security: [{ apiKey: [] }],
    },
  });

  const failures = createFailureLimiter(options.authFailuresPerMinute);
  app.addHook('onRequest', async (request) => {
    const route = request.routeOptions.url;
    if (route === undefined || PUBLIC_ROUTES.has(route)) return;
    if (failures.blocked(request.ip)) throw new HttpError(429, 'Too many failed authentication attempts; retry in a minute');
    const key = presentedKey(request.headers);
    if (!key) throw new HttpError(401, 'Missing API key: send Authorization: Bearer <key>');
    const identity = await options.keys.findActiveByHash(hashApiKey(key));
    if (!identity) {
      failures.record(request.ip);
      throw new HttpError(401, 'Invalid or revoked API key');
    }
    request.apiKey = identity;
    options.keys.markUsed(identity.id).catch((err: unknown) => request.log.warn({ err }, 'could not record API key use'));
    const required = request.routeOptions.config?.scope;
    if (required && !identity.scopes.includes(required)) {
      throw new HttpError(403, `This API key lacks the "${required}" scope`, 'missing_scope');
    }
  });

  await app.register(rateLimit, {
    hook: 'preHandler',
    max: options.rateLimitPerMinute,
    timeWindow: 60_000,
    keyGenerator: (request) => (request.apiKey ? `key:${request.apiKey.id}` : `ip:${request.ip}`),
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit of ${context.max} requests per minute exceeded; retry in ${context.after}`,
    }),
  });

  // What kind of data this database holds, stamped on every response and export. Cached briefly; a label never changes.
  let datasetCache: { value: Dataset; at: number } | null = null;
  const dataset = async (): Promise<Dataset> => {
    if (!datasetCache || Date.now() - datasetCache.at > 5_000) datasetCache = { value: await readDataset(db), at: Date.now() };
    return datasetCache.value;
  };

  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    const current = await dataset().catch(() => null);
    if (current) reply.header('x-corpact-dataset', current.kind);
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const record = error as { statusCode?: unknown; message?: unknown };
    const status = error instanceof HttpError ? error.statusCode : typeof record.statusCode === 'number' ? record.statusCode : 500;
    if (status >= 500) request.log.error(error);
    const message = typeof record.message === 'string' ? record.message : String(error);
    const code = error instanceof HttpError ? error.code : undefined;
    reply.code(status).send(status >= 500 ? { error: 'Internal error' } : { error: message, ...(code ? { code } : {}) });
  });

  function requireOwner(value: string): string {
    if (!isAddress(value)) throw new HttpError(400, 'owner must be a base58 Solana address');
    return value;
  }

  /** A tenant reads only wallets it registered; anything else is indistinguishable from not existing. */
  async function authorizeWallet(request: FastifyRequest, value: string): Promise<string> {
    const owner = requireOwner(value);
    if (!(await options.access.isRegistered(request.apiKey!.tenantId, owner))) {
      throw new HttpError(404, 'This wallet is not registered for your tenant; request a sync to register it', 'wallet_not_registered');
    }
    return owner;
  }

  async function syncStatus(owner: string) {
    const { rows } = await db.query('SELECT * FROM wallet_syncs WHERE owner = $1', [owner]);
    const r = rows[0];
    if (!r) return null;
    return {
      owner,
      status: r.status,
      requestedAt: r.requested_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      asOfSlot: r.as_of_slot,
      asOfTime: iso(r.as_of_unix),
      transactionsFetched: r.transactions_fetched,
      gaps: r.gaps,
      error: r.error,
      progress: r.progress,
    };
  }

  app.get(
    '/v1/health',
    { schema: { tags: ['service'], summary: 'Service and database health', security: [], response: { 200: schemas.healthResponse } } },
    async () => {
      await db.query('SELECT 1');
      return { ok: true, dataset: await dataset() };
    },
  );

  app.get('/v1/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  app.get(
    '/v1/assets',
    {
      config: { scope: 'assets:read' },
      schema: { tags: ['assets'], summary: 'Supported mints and their verification status', response: { 200: schemas.assetsResponse, ...errors } },
    },
    async () => {
      const { rows } = await db.query(
        `SELECT mint, symbol, name, decimals, registry_source, verification_error, verified_slot FROM assets ORDER BY symbol`,
      );
      return {
        assets: rows.map((r) => ({
          mint: r.mint,
          symbol: r.symbol,
          name: r.name,
          decimals: r.decimals,
          registrySource: r.registry_source,
          verified: r.verification_error === null && r.decimals !== null,
          verificationError: r.verification_error,
          verifiedSlot: r.verified_slot,
          capabilities: { tracking: r.verification_error === null, manualConversion: false, automation: false },
        })),
      };
    },
  );

  app.post(
    '/v1/wallets/sync',
    {
      config: { scope: 'wallets:sync' },
      schema: {
        tags: ['wallets'],
        summary: "Register a wallet to the caller's tenant and request an idempotent historical sync",
        body: schemas.syncRequestBody,
        response: { 202: schemas.syncRequestResponse, ...errors },
      },
    },
    async (request, reply) => {
      const owner = requireOwner((request.body as { owner: string }).owner);
      const registration = await options.access.register(request.apiKey!.tenantId, owner);
      if (registration === 'quota_exceeded') {
        throw new HttpError(403, 'Wallet limit reached for your tenant; contact Corpact to raise it', 'wallet_quota_exceeded');
      }
      const result = await withTransaction(db, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO wallet_syncs (owner, status, requested_at) VALUES ($1, 'queued', now())
           ON CONFLICT (owner) DO UPDATE SET requested_at = now(),
             status = CASE WHEN wallet_syncs.status = 'running' THEN 'running' ELSE 'queued' END
           RETURNING status`,
          [owner],
        );
        const job = await enqueueJob(client, { kind: 'sync_wallet', businessKey: `sync_wallet:${owner}`, payload: { owner }, maxAttempts: 3 });
        return { status: rows[0].status as string, job };
      });
      reply.code(202).send({ owner, registration, ...result });
    },
  );

  app.get(
    '/v1/wallets',
    {
      config: { scope: 'ledger:read' },
      schema: { tags: ['wallets'], summary: "Wallets registered to the caller's tenant", response: { 200: schemas.walletsResponse, ...errors } },
    },
    async (request) => {
      const { tenant, maxWallets, wallets } = await options.access.list(request.apiKey!.tenantId);
      return { tenant, maxWallets, wallets };
    },
  );

  app.get(
    '/v1/wallets/:owner/status',
    {
      config: { scope: 'ledger:read' },
      schema: {
        tags: ['wallets'],
        summary: 'Progress and result of the latest sync',
        params: schemas.ownerParams,
        response: { 200: schemas.syncStatusResponse, ...errors },
      },
    },
    async (request) => {
      const owner = await authorizeWallet(request, (request.params as { owner: string }).owner);
      return { sync: await syncStatus(owner) };
    },
  );

  app.get(
    '/v1/portfolio',
    {
      config: { scope: 'ledger:read' },
      schema: {
        tags: ['ledger'],
        summary: 'Positions, dividend income, convertible exposure and coverage for a wallet',
        querystring: schemas.ownerQuery,
        response: { 200: schemas.portfolioResponse, ...errors },
      },
    },
    async (request) => {
      const owner = await authorizeWallet(request, (request.query as { owner: string }).owner);
      const { rows } = await db.query(
        `SELECT p.*, a.symbol, a.name,
                (SELECT count(*) FROM income_entries e WHERE e.position_epoch_id = p.id AND e.kind = 'dividend')::int AS dividend_count,
                (SELECT count(*) FROM income_entries e WHERE e.position_epoch_id = p.id AND e.kind = 'dividend' AND e.usd IS NULL)::int AS unvalued_count,
                (SELECT count(*) FROM income_entries e WHERE e.position_epoch_id = p.id
                    AND (e.kind IN ('unclassified_adjustment', 'distribution', 'identity_change') OR e.action_kind = 'stock_dividend'))::int AS unclassified_count,
                (SELECT coalesce(sum(e.usd), 0)::text FROM income_entries e WHERE e.position_epoch_id = p.id AND e.usd IS NOT NULL) AS income_usd
           FROM position_epochs p JOIN assets a ON a.mint = p.mint
          WHERE p.owner = $1
          ORDER BY a.symbol`,
        [owner],
      );

      let totalIncome = Rational.ZERO;
      let unvalued = 0;
      let unclassified = 0;
      const positions = rows.map((p) => {
        const decimals = Number(p.decimals);
        const view = positionView({
          mint: p.mint,
          decimals,
          raw: BigInt(p.raw_balance),
          multiplier: float64FromBits(p.multiplier_bits),
          floor: Rational.of(BigInt(p.floor_num), BigInt(p.floor_den)),
          entries: [],
        });
        const income = Rational.fromDecimal(p.income_usd);
        totalIncome = totalIncome.add(income);
        unvalued += p.unvalued_count;
        unclassified += p.unclassified_count;
        const tracked = p.status !== 'unsupported' && p.replay_complete;
        return {
          mint: p.mint,
          symbol: p.symbol,
          name: p.name,
          status: p.status,
          decimals,
          rawBalance: p.raw_balance,
          quantity: towardZero(view.quantity, decimals),
          protectedQuantity: tracked ? towardZero(view.floor, decimals) : null,
          availableQuantity: tracked ? towardZero(view.availableQuantity, decimals) : null,
          maximumConvertibleRaw: tracked ? view.maximumHarvestRaw.toString() : null,
          dividendIncomeUsd: exact(income),
          dividendEvents: p.dividend_count,
          unvaluedDividendEvents: p.unvalued_count,
          unclassifiedAdjustments: p.unclassified_count,
          reconciled: p.reconciled,
          replayComplete: p.replay_complete,
          conversionDisabledReasons: p.conversion_disabled_reasons,
          coverage: {
            start: iso(p.coverage_start_unix),
            end: iso(p.coverage_end_unix),
            startSlot: p.coverage_start_slot,
            endSlot: p.coverage_end_slot,
            gaps: p.gaps,
          },
          computedAt: p.computed_at,
        };
      });

      const starts = rows.filter((p) => p.status !== 'unsupported' && p.coverage_start_unix !== null).map((p) => Number(p.coverage_start_unix));
      const endSlots = rows.map((p) => BigInt(p.coverage_end_slot));
      return {
        owner,
        dataset: await dataset(),
        asOfSlot: endSlots.length ? endSlots.reduce((a, b) => (a < b ? a : b)).toString() : null,
        asOfTime: rows.length ? iso(rows.map((p) => p.coverage_end_unix).sort()[0]) : null,
        dataStatus: await syncStatus(owner),
        valuationStatus: NO_PRICE_SOURCE,
        coverage: {
          trackingStart: starts.length ? new Date(Math.min(...starts) * 1000).toISOString() : null,
          complete: rows.length > 0 && rows.every((p) => p.status === 'complete'),
          partialPositions: rows.filter((p) => p.status === 'partial').length,
          unsupportedPositions: rows.filter((p) => p.status === 'unsupported').length,
        },
        totals: {
          dividendIncomeUsd: exact(totalIncome),
          unvaluedDividendEvents: unvalued,
          unclassifiedAdjustments: unclassified,
          availableToConvert: {
            usd: null,
            reason: 'Positions hold different stocks; without a price source they are shown per position, not summed',
            positionsWithAvailable: positions.filter(
              (p) => p.availableQuantity !== null && Rational.fromDecimal(p.availableQuantity).compare(Rational.ZERO) > 0,
            ).length,
          },
          usdcReceived: { usd: '0', reason: CONVERSION_NOT_ENABLED },
        },
        positions,
      };
    },
  );

  app.get(
    '/v1/income',
    {
      config: { scope: 'ledger:read' },
      schema: {
        tags: ['ledger'],
        summary: 'Dividend, split and unclassified entries, newest first',
        querystring: schemas.incomeQuery,
        response: { 200: schemas.incomeResponse, ...errors },
      },
    },
    async (request) => {
      const q = request.query as { owner: string; limit: number; offset: number };
      const owner = await authorizeWallet(request, q.owner);
      const { rows } = await db.query(
        `SELECT e.id, e.kind, e.effective_unix, e.quantity_num, e.quantity_den, e.split_factor_num, e.split_factor_den,
                e.usd, e.valuation, e.warnings, e.reasons, p.mint, a.symbol, a.decimals, e.interpretation_revision, e.last_corrected_at,
                e.distributed_fraction_num, e.distributed_fraction_den, e.action_kind
           FROM income_entries e JOIN position_epochs p ON p.id = e.position_epoch_id JOIN assets a ON a.mint = p.mint
          WHERE p.owner = $1
          ORDER BY e.effective_unix DESC, e.id DESC
          LIMIT $2 OFFSET $3`,
        [owner, q.limit + 1, q.offset],
      );
      const entries = rows.slice(0, q.limit).map((r) => {
        const quantity = Rational.of(BigInt(r.quantity_num), BigInt(r.quantity_den));
        const entry = {
          id: String(r.id),
          mint: r.mint,
          symbol: r.symbol,
          kind: v1Kind(r),
          effectiveAt: iso(r.effective_unix),
          quantity: exact(quantity),
          quantityDisplay: towardZero(quantity, Number(r.decimals)),
          splitFactor: v1SplitFactor(r),
          usd: r.usd === null ? null : exact(Rational.fromDecimal(r.usd)),
          valuation: r.valuation,
          warnings: r.warnings as string[],
          reasons: v1Reasons(r),
        };
        const headline = describeEntry({ ...entry, kind: r.kind, action: r.action_kind ?? null, distributedPercent: distributedPercent(r), factor: factorText(r) });
        return { ...entry, headline, revision: r.interpretation_revision as number, correctedAt: r.last_corrected_at };
      });
      return { owner, dataset: await dataset(), entries, nextOffset: rows.length > q.limit ? q.offset + q.limit : null };
    },
  );

  app.get(
    '/v1/income/:id',
    {
      config: { scope: 'ledger:read' },
      schema: {
        tags: ['ledger'],
        summary: 'One entry with its chain, classification and issuer evidence',
        params: schemas.incomeEventParams,
        querystring: schemas.ownerQuery,
        response: { 200: schemas.incomeDetail, ...errors },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const owner = await authorizeWallet(request, (request.query as { owner: string }).owner);
      const { rows } = await db.query(
        `SELECT e.*, p.owner, p.mint, a.symbol, a.decimals,
                v.update_signature, v.observed_slot, v.observed_instruction_path, v.scheduled_unix, v.effective_unix AS version_effective_unix,
                v.immediate, v.old_multiplier_bits, v.new_multiplier_bits, v.old_multiplier_exact, v.new_multiplier_exact, v.status AS version_status,
                m.classifier_version, m.classification, m.action_kind AS match_action_kind, m.external_id, m.revision, m.net_cash_per_share,
                m.reasons AS match_reasons, m.warnings AS match_warnings,
                ca.payload AS action_payload, ca.source AS action_source, ca.evidence_sha256
           FROM income_entries e
           JOIN position_epochs p ON p.id = e.position_epoch_id
           JOIN assets a ON a.mint = p.mint
           JOIN multiplier_versions v ON v.id = e.multiplier_version_id
           LEFT JOIN action_matches m ON m.id = e.action_match_id
           LEFT JOIN corporate_actions ca ON ca.issuer = m.issuer AND ca.external_id = m.external_id AND ca.revision = m.revision
          WHERE e.id = $1 AND p.owner = $2`,
        [id, owner],
      );
      const r = rows[0];
      if (!r) throw new HttpError(404, 'No such event for this owner');
      const { rows: historyRows } = await db.query(
        'SELECT * FROM ledger_journal WHERE owner = $1 AND multiplier_version_id = $2 ORDER BY id',
        [owner, r.multiplier_version_id],
      );
      const quantity = Rational.of(BigInt(r.quantity_num), BigInt(r.quantity_den));
      const base = {
        kind: v1Kind(r),
        quantity: exact(quantity),
        quantityDisplay: towardZero(quantity, Number(r.decimals)),
        symbol: r.symbol,
        usd: r.usd === null ? null : exact(Rational.fromDecimal(r.usd)),
        valuation: r.valuation,
        warnings: r.warnings as string[],
        reasons: v1Reasons(r),
      };
      return {
        id,
        owner,
        mint: r.mint,
        ...base,
        headline: describeEntry({ ...base, kind: r.kind, action: r.action_kind ?? null, distributedPercent: distributedPercent(r), factor: factorText(r) }),
        effectiveAt: iso(r.effective_unix),
        revision: r.interpretation_revision as number,
        correctedAt: r.last_corrected_at,
        history: historyRows.map(journalEntryFromRow),
        evidence: {
          chain: {
            updateSignature: r.update_signature,
            explorerUrl: `https://solscan.io/tx/${r.update_signature}`,
            observedSlot: r.observed_slot,
            instructionPath: r.observed_instruction_path,
            scheduledAt: iso(r.scheduled_unix),
            effectiveAt: iso(r.version_effective_unix),
            immediate: r.immediate,
            status: r.version_status,
            multiplierBefore: { bits: r.old_multiplier_bits, exact: r.old_multiplier_exact },
            multiplierAfter: { bits: r.new_multiplier_bits, exact: r.new_multiplier_exact },
          },
          classification: r.classification
            ? {
                classifierVersion: r.classifier_version,
                result: v1Result(r.classification, r.match_action_kind ?? null),
                issuerEventId: r.external_id,
                issuerRevision: r.revision,
                netCashPerShare: r.net_cash_per_share,
                reasons: r.match_reasons,
                warnings: r.match_warnings,
              }
            : { result: 'pending', reasons: ['Classification pending'] },
          issuerRecord: r.action_payload ? { source: r.action_source, evidenceSha256: r.evidence_sha256, record: r.action_payload } : null,
        },
      };
    },
  );

  app.get(
    '/v1/yield',
    {
      config: { scope: 'ledger:read' },
      schema: {
        tags: ['ledger'],
        summary: 'Income and share yield per window, and trailing net distribution per share, with coverage',
        querystring: schemas.ownerQuery,
        response: { 200: schemas.yieldResponse, ...errors },
      },
    },
    async (request) => {
      const owner = await authorizeWallet(request, (request.query as { owner: string }).owner);
      const { rows: positionRows } = await db.query(
        `SELECT p.id, p.mint, p.status, p.coverage_start_unix, p.coverage_end_unix, a.symbol
           FROM position_epochs p JOIN assets a ON a.mint = p.mint
          WHERE p.owner = $1
          ORDER BY a.symbol`,
        [owner],
      );

      const positions = [];
      for (const p of positionRows) {
        const [samples, dividends, splits, actions, cursor] = await Promise.all([
          db.query('SELECT effective_unix, quantity_num, quantity_den FROM position_quantity_samples WHERE position_epoch_id = $1 ORDER BY seq', [p.id]),
          db.query(`SELECT effective_unix, quantity_num, quantity_den, usd FROM income_entries WHERE position_epoch_id = $1 AND kind = 'dividend'`, [p.id]),
          // v1 yield predates stock dividends: they stay outside its split basis, as when they were unclassified.
          db.query(
            `SELECT effective_unix, split_factor_num, split_factor_den FROM income_entries WHERE position_epoch_id = $1 AND kind = 'split' AND action_kind IS DISTINCT FROM 'stock_dividend'`,
            [p.id],
          ),
          db.query(
            `SELECT v.effective_unix, m.classification, m.net_cash_per_share, m.split_factor_num, m.split_factor_den
               FROM multiplier_versions v JOIN action_matches m ON m.multiplier_version_id = v.id AND m.superseded_at IS NULL
              WHERE v.mint = $1 AND v.status IN ('active', 'orphaned') AND m.classification IN ('dividend', 'split')
                AND m.action_kind IS DISTINCT FROM 'stock_dividend'`,
            [p.mint],
          ),
          db.query('SELECT state FROM sync_cursors WHERE stream = $1', [`multiplier-timeline:${p.mint}`]),
        ]);

        const end = BigInt(p.coverage_end_unix);
        const coverageStart = p.status === 'unsupported' || p.coverage_start_unix === null ? null : BigInt(p.coverage_start_unix);
        const quantitySamples = samples.rows.map((r) => ({ unix: BigInt(r.effective_unix), quantity: ratio(r.quantity_num, r.quantity_den) }));
        const dividendPoints = dividends.rows.map((r) => ({
          unix: BigInt(r.effective_unix),
          quantity: ratio(r.quantity_num, r.quantity_den),
          usd: r.usd === null ? null : Rational.fromDecimal(r.usd),
        }));
        const splitPoints = splits.rows.map((r) => ({ unix: BigInt(r.effective_unix), factor: ratio(r.split_factor_num, r.split_factor_den) }));

        const specs: Array<{ window: 'trailing_30d' | 'trailing_365d' | 'tracked'; start: bigint }> = [
          { window: 'trailing_30d', start: end - 30n * DAY },
          { window: 'trailing_365d', start: end - 365n * DAY },
          ...(coverageStart !== null && coverageStart < end ? [{ window: 'tracked' as const, start: coverageStart }] : []),
        ];
        const windows =
          p.status === 'unsupported'
            ? []
            : specs.map(({ window, start }) => {
                const m = windowMetrics({
                  samples: quantitySamples,
                  dividends: dividendPoints,
                  splits: splitPoints,
                  coverageStart,
                  positionComplete: p.status === 'complete',
                  window: { start, end },
                });
                return {
                  window,
                  start: iso(start.toString()),
                  end: iso(end.toString()),
                  days: Number((end - start) / DAY),
                  partial: m.partial,
                  coveredStart: iso(m.coveredStart.toString()),
                  incomeUsd: exact(m.incomeUsd),
                  valuedDividends: m.valuedDividends,
                  unvaluedDividends: m.unvaluedDividends,
                  dividendQuantity: exact(m.dividendQuantity),
                  averageQuantity: m.averageQuantity ? m.averageQuantity.toFixed(8) : null,
                  shareYield: m.shareYield ? m.shareYield.toFixed(10) : null,
                  excluded: m.excluded,
                };
              });

        const assetSplits = actions.rows
          .filter((r) => r.classification === 'split')
          .map((r) => ({ unix: BigInt(r.effective_unix), factor: ratio(r.split_factor_num, r.split_factor_den) }));
        const distributions = actions.rows
          .filter((r) => r.classification === 'dividend')
          .map((r) => ({ unix: BigInt(r.effective_unix), netCashPerShare: r.net_cash_per_share === null ? null : Rational.fromDecimal(r.net_cash_per_share) }));
        const knownFrom = cursor.rows[0]?.state?.knownFrom?.unixTime as string | undefined;
        const ttmStart = end - 365n * DAY;
        const ttm = trailingDistributionPerShare({
          distributions,
          splits: assetSplits,
          knownFrom: knownFrom === undefined ? null : BigInt(knownFrom),
          window: { start: ttmStart, end },
        });

        positions.push({
          mint: p.mint,
          symbol: p.symbol,
          status: p.status,
          asOf: iso(p.coverage_end_unix),
          windows,
          trailingDistribution: {
            windowStart: iso(ttmStart.toString()),
            windowEnd: iso(end.toString()),
            netPerShare: ttm.perShare ? exact(ttm.perShare) : null,
            distributions: ttm.distributions,
            missingNetCash: ttm.missingNetCash,
            partial: ttm.partial,
            excluded: ttm.excluded,
          },
          distributionYield: { value: null, reason: 'No price source is configured' },
        });
      }
      return { owner, dataset: await dataset(), definitions: YIELD_DEFINITIONS, positions };
    },
  );

  app.get(
    '/v1/export',
    {
      config: { scope: 'ledger:read' },
      schema: {
        tags: ['ledger'],
        summary: 'CSV export: the append-only journal (default) or current income entries, with confidence fields',
        querystring: schemas.exportQuery,
        response: {
          200: { description: 'CSV (RFC 4180, CRLF line endings)', content: { 'text/csv': { schema: { type: 'string' } } } },
          422: schemas.errorResponse,
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const q = request.query as { owner: string; dataset: 'journal' | 'income' };
      const owner = await authorizeWallet(request, q.owner);
      // Exact values for reconciliation, then rounded ones a spreadsheet can hold (it keeps ~15 significant digits).
      const amounts = (r: Record<string, any>) => {
        const quantity = ratio(r.quantity_num, r.quantity_den);
        const usd = r.usd === null ? null : Rational.fromDecimal(r.usd);
        return [
          exact(quantity),
          towardZero(quantity, Number(r.decimals)),
          v1SplitFactor(r),
          usd === null ? null : exact(usd),
          usd === null ? null : usd.toFixed(2),
        ];
      };
      let csv: string;
      if (q.dataset === 'journal') {
        const { rows } = await db.query(
          `SELECT j.*, a.symbol, a.decimals, p.status AS position_status, p.reconciled, p.coverage_start_unix
             FROM ledger_journal j JOIN assets a ON a.mint = j.mint
             LEFT JOIN position_epochs p ON p.owner = j.owner AND p.mint = j.mint
            WHERE j.owner = $1
            ORDER BY j.id
            LIMIT $2`,
          [owner, EXPORT_ROW_LIMIT + 1],
        );
        if (rows.length > EXPORT_ROW_LIMIT) throw new HttpError(422, `Export exceeds ${EXPORT_ROW_LIMIT} rows; page through /v1/journal instead`);
        csv = toCsv(
          JOURNAL_CSV_COLUMNS,
          rows.map((r) => [
            isoOfDate(r.recorded_at), r.entry_type, r.entry_type === 'reversal' ? '-1' : '1', r.owner, r.symbol, r.mint, iso(r.effective_unix), v1Kind(r),
            ...amounts(r),
            r.valuation, r.issuer_event_id, r.issuer_revision, String(r.id), r.reverses_id === null ? null : String(r.reverses_id),
            r.change_reason, r.change_detail, r.position_status ?? null, r.reconciled ?? null, iso(r.coverage_start_unix ?? null),
          ]),
        );
      } else {
        const { rows } = await db.query(
          `SELECT e.*, p.mint, p.status AS position_status, p.reconciled, p.coverage_start_unix, a.symbol, a.decimals
             FROM income_entries e JOIN position_epochs p ON p.id = e.position_epoch_id JOIN assets a ON a.mint = p.mint
            WHERE p.owner = $1
            ORDER BY e.effective_unix, e.id
            LIMIT $2`,
          [owner, EXPORT_ROW_LIMIT + 1],
        );
        if (rows.length > EXPORT_ROW_LIMIT) throw new HttpError(422, `Export exceeds ${EXPORT_ROW_LIMIT} rows; page through /v1/income instead`);
        csv = toCsv(
          INCOME_CSV_COLUMNS,
          rows.map((r) => [
            iso(r.effective_unix), r.symbol, r.mint, v1Kind(r),
            ...amounts(r),
            r.valuation, r.interpretation_revision, isoOfDate(r.last_corrected_at),
            ((r.warnings as string[] | null) ?? []).join(' | '), v1Reasons(r).join(' | '),
            r.position_status, r.reconciled, iso(r.coverage_start_unix),
          ]),
        );
      }
      // A saved file must say what it is on its own: every row carries the dataset, and synthetic files say so in the name.
      const label = await dataset();
      const lines = csv.split('\r\n');
      csv = lines.map((line, i) => (line === '' ? line : `${i === 0 ? 'dataset' : label.kind},${line}`)).join('\r\n');
      const filename = `corpact-${label.kind === 'synthetic' ? 'SYNTHETIC-' : ''}${q.dataset}-${owner.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
      return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${filename}"`).send(csv);
    },
  );

  const collect = options.collectMonitoring ?? ((database: Db) => collectSnapshot(database));

  app.get(
    '/v1/ops/status',
    {
      config: { scope: 'ops:read' },
      schema: { tags: ['ops'], summary: 'Monitoring checks with thresholds (PLAN §14)', response: { 200: schemas.opsStatusResponse, ...errors } },
    },
    async () => {
      const snapshot = await collect(db);
      const result = evaluateChecks(snapshot);
      return { status: result.status, checkedAt: new Date(snapshot.nowUnix * 1000).toISOString(), checks: result.checks };
    },
  );

  app.get(
    '/v1/ops/metrics',
    {
      config: { scope: 'ops:read' },
      schema: {
        tags: ['ops'],
        summary: 'Prometheus metrics (scrape with the key as a bearer token)',
        response: { 200: { description: 'Prometheus text exposition 0.0.4', content: { 'text/plain': { schema: { type: 'string' } } } }, ...errors },
      },
    },
    async (_request, reply) => {
      const snapshot = await collect(db);
      return reply.type('text/plain; version=0.0.4; charset=utf-8').send(toPrometheus(snapshot, evaluateChecks(snapshot)));
    },
  );

  app.get(
    '/v1/journal',
    {
      config: { scope: 'ledger:read' },
      schema: {
        tags: ['ledger'],
        summary: 'Append-only audit trail: every recognition and reversal of income, newest first',
        querystring: schemas.incomeQuery,
        response: { 200: schemas.journalResponse, ...errors },
      },
    },
    async (request) => {
      const q = request.query as { owner: string; limit: number; offset: number };
      const owner = await authorizeWallet(request, q.owner);
      const { rows } = await db.query(
        `SELECT j.*, a.symbol FROM ledger_journal j JOIN assets a ON a.mint = j.mint
          WHERE j.owner = $1
          ORDER BY j.id DESC
          LIMIT $2 OFFSET $3`,
        [owner, q.limit + 1, q.offset],
      );
      return {
        owner,
        dataset: await dataset(),
        entries: rows.slice(0, q.limit).map((r) => ({ ...journalEntryFromRow(r), mint: r.mint, symbol: r.symbol })),
        nextOffset: rows.length > q.limit ? q.offset + q.limit : null,
      };
    },
  );

  await registerV2(app, { db, dataset, authorizeWallet });

  return app;
}
