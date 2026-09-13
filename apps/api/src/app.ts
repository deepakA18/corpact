import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { positionView } from '@corpact/accounting';
import { schemas } from '@corpact/client';
import { enqueueJob, withTransaction, type Db } from '@corpact/db';
import { Rational } from '@corpact/domain';
import { float64FromBits, isAddress } from '@corpact/solana';
import { hashApiKey, type ApiKeyIdentity, type ApiKeyStore } from './keys';

export const API_VERSION = '0.1.0';
export const DEFAULT_DATABASE_URL = 'postgres://parityfi:parityfi-dev@127.0.0.1:54329/parityfi';

const PUBLIC_ROUTES = new Set(['/v1/health', '/v1/openapi.json']);
const CONVERSION_NOT_ENABLED = 'Conversion is not enabled in this release';
const NO_PRICE_SOURCE = 'No event-time price source is configured; USD values come only from issuer net cash';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyIdentity;
  }
}

export interface AppOptions {
  db: Db;
  keys: ApiKeyStore;
  rateLimitPerMinute: number;
  /** Failed key presentations tolerated per client IP per minute before refusing further attempts. */
  authFailuresPerMinute: number;
  /** Only needed when a browser calls the API directly; the demo dashboard goes through its own server. */
  corsOrigin?: string | undefined;
  logger?: FastifyServerOptions['logger'];
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const iso = (unix: string | null | undefined) => (unix == null ? null : new Date(Number(unix) * 1000).toISOString());

/** Exact when the value terminates (all ledger values here do); otherwise 18 places. */
function exact(r: Rational): string {
  try {
    return r.toTerminatingDecimal();
  } catch {
    return r.toFixed(18);
  }
}

/** Round toward zero at `scale` places — never displays more convertible exposure than exists. */
function towardZero(r: Rational, scale: number): string {
  const scaled = r.mul(Rational.of(10n ** BigInt(scale)));
  const truncated = scaled.isNegative() ? scaled.ceil() : scaled.floor();
  const negative = truncated < 0n;
  const digits = (negative ? -truncated : truncated).toString().padStart(scale + 1, '0');
  const body = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${body}` : body;
}

function describeEntry(e: {
  kind: string;
  quantityDisplay: string;
  symbol: string;
  usd: string | null;
  warnings: string[];
  reasons: string[];
}): string {
  if (e.kind === 'dividend') {
    const value =
      e.usd !== null
        ? `Value from issuer-reported net cash reinvested: $${Rational.fromDecimal(e.usd).toFixed(2)}.`
        : `USD value unavailable${e.warnings[0] ? ` — ${e.warnings[0]}` : ''}.`;
    return `Your ${e.symbol} position gained ${e.quantityDisplay} stock-equivalent units from a verified dividend adjustment. ${value} This remains invested in the stock.`;
  }
  if (e.kind === 'split') return 'Stock split applied; no dividend income recorded.';
  return `Balance adjustment detected; classification pending.${e.reasons[0] ? ` ${e.reasons[0]}.` : ''} No income recorded.`;
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

const errors = { 400: schemas.errorResponse, 401: schemas.errorResponse, 429: schemas.errorResponse } as const;

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

  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const record = error as { statusCode?: unknown; message?: unknown };
    const status = error instanceof HttpError ? error.statusCode : typeof record.statusCode === 'number' ? record.statusCode : 500;
    if (status >= 500) request.log.error(error);
    const message = typeof record.message === 'string' ? record.message : String(error);
    reply.code(status).send({ error: status >= 500 ? 'Internal error' : message });
  });

  function requireOwner(value: string): string {
    if (!isAddress(value)) throw new HttpError(400, 'owner must be a base58 Solana address');
    return value;
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
      return { ok: true };
    },
  );

  app.get('/v1/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  app.get(
    '/v1/assets',
    { schema: { tags: ['assets'], summary: 'Supported mints and their verification status', response: { 200: schemas.assetsResponse, ...errors } } },
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
      schema: {
        tags: ['wallets'],
        summary: 'Request an idempotent historical sync for a wallet',
        body: schemas.syncRequestBody,
        response: { 202: schemas.syncRequestResponse, ...errors },
      },
    },
    async (request, reply) => {
      const owner = requireOwner((request.body as { owner: string }).owner);
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
      reply.code(202).send({ owner, ...result });
    },
  );

  app.get(
    '/v1/wallets/:owner/status',
    {
      schema: {
        tags: ['wallets'],
        summary: 'Progress and result of the latest sync',
        params: schemas.ownerParams,
        response: { 200: schemas.syncStatusResponse, ...errors },
      },
    },
    async (request) => {
      const owner = requireOwner((request.params as { owner: string }).owner);
      return { sync: await syncStatus(owner) };
    },
  );

  app.get(
    '/v1/portfolio',
    {
      schema: {
        tags: ['ledger'],
        summary: 'Positions, dividend income, convertible exposure and coverage for a wallet',
        querystring: schemas.ownerQuery,
        response: { 200: schemas.portfolioResponse, ...errors },
      },
    },
    async (request) => {
      const owner = requireOwner((request.query as { owner: string }).owner);
      const { rows } = await db.query(
        `SELECT p.*, a.symbol, a.name,
                (SELECT count(*) FROM income_entries e WHERE e.position_epoch_id = p.id AND e.kind = 'dividend')::int AS dividend_count,
                (SELECT count(*) FROM income_entries e WHERE e.position_epoch_id = p.id AND e.kind = 'dividend' AND e.usd IS NULL)::int AS unvalued_count,
                (SELECT count(*) FROM income_entries e WHERE e.position_epoch_id = p.id AND e.kind = 'unclassified_adjustment')::int AS unclassified_count,
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
      schema: {
        tags: ['ledger'],
        summary: 'Dividend, split and unclassified entries, newest first',
        querystring: schemas.incomeQuery,
        response: { 200: schemas.incomeResponse, ...errors },
      },
    },
    async (request) => {
      const q = request.query as { owner: string; limit: number; offset: number };
      const owner = requireOwner(q.owner);
      const { rows } = await db.query(
        `SELECT e.id, e.kind, e.effective_unix, e.quantity_num, e.quantity_den, e.split_factor_num, e.split_factor_den,
                e.usd, e.valuation, e.warnings, e.reasons, p.mint, a.symbol, a.decimals
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
          kind: r.kind,
          effectiveAt: iso(r.effective_unix),
          quantity: exact(quantity),
          quantityDisplay: towardZero(quantity, Number(r.decimals)),
          splitFactor: r.split_factor_num === null ? null : exact(Rational.of(BigInt(r.split_factor_num), BigInt(r.split_factor_den))),
          usd: r.usd === null ? null : exact(Rational.fromDecimal(r.usd)),
          valuation: r.valuation,
          warnings: r.warnings as string[],
          reasons: r.reasons as string[],
        };
        return { ...entry, headline: describeEntry(entry) };
      });
      return { owner, entries, nextOffset: rows.length > q.limit ? q.offset + q.limit : null };
    },
  );

  app.get(
    '/v1/income/:id',
    {
      schema: {
        tags: ['ledger'],
        summary: 'One entry with its chain, classification and issuer evidence',
        params: schemas.incomeEventParams,
        querystring: schemas.ownerQuery,
        response: { 200: schemas.incomeDetail, 404: schemas.errorResponse, ...errors },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const owner = requireOwner((request.query as { owner: string }).owner);
      const { rows } = await db.query(
        `SELECT e.*, p.owner, p.mint, a.symbol, a.decimals,
                v.update_signature, v.observed_slot, v.observed_instruction_path, v.scheduled_unix, v.effective_unix AS version_effective_unix,
                v.immediate, v.old_multiplier_bits, v.new_multiplier_bits, v.old_multiplier_exact, v.new_multiplier_exact, v.status AS version_status,
                m.classifier_version, m.classification, m.external_id, m.revision, m.net_cash_per_share,
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
      const quantity = Rational.of(BigInt(r.quantity_num), BigInt(r.quantity_den));
      const base = {
        kind: r.kind,
        quantity: exact(quantity),
        quantityDisplay: towardZero(quantity, Number(r.decimals)),
        symbol: r.symbol,
        usd: r.usd === null ? null : exact(Rational.fromDecimal(r.usd)),
        valuation: r.valuation,
        warnings: r.warnings as string[],
        reasons: r.reasons as string[],
      };
      return {
        id,
        owner,
        mint: r.mint,
        ...base,
        headline: describeEntry(base),
        effectiveAt: iso(r.effective_unix),
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
                result: r.classification,
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

  return app;
}
