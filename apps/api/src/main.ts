import cors from '@fastify/cors';
import Fastify from 'fastify';
import { positionView } from '@corpact/accounting';
import { createDb, enqueueJob, withTransaction } from '@corpact/db';
import { Rational } from '@corpact/domain';
import { float64FromBits, isAddress } from '@corpact/solana';

/**
 * Read-only tracker API (PLAN §8 subset). All quantities and amounts are strings.
 * Not yet: wallet-signed auth, rate limiting, idempotency keys — see the build notes.
 */
const db = createDb(process.env.DATABASE_URL ?? 'postgres://parityfi:parityfi-dev@127.0.0.1:54329/parityfi');
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(cors, { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });

const CONVERSION_NOT_ENABLED = 'Conversion is not enabled in this release';
const NO_PRICE_SOURCE = 'No event-time price source is configured; USD values come only from issuer net cash';

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const iso = (unix: string | null | undefined) => (unix == null ? null : new Date(Number(unix) * 1000).toISOString());

function requireOwner(value: unknown): string {
  if (typeof value !== 'string' || !isAddress(value)) throw new HttpError(400, 'owner must be a base58 Solana address');
  return value;
}

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
  valuation: string | null;
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

app.setErrorHandler((error: unknown, _request, reply) => {
  const status = error instanceof HttpError ? error.statusCode : ((error as { statusCode?: number }).statusCode ?? 500);
  if (status >= 500) app.log.error(error);
  const message = error instanceof Error ? error.message : String(error);
  reply.code(status).send({ error: status >= 500 ? 'Internal error' : message });
});

app.get('/v1/health', async () => {
  await db.query('SELECT 1');
  return { ok: true };
});

app.get('/v1/assets', async () => {
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
});

app.post('/v1/wallets/sync', async (request, reply) => {
  const owner = requireOwner((request.body as { owner?: unknown } | undefined)?.owner);
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
});

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

app.get('/v1/wallets/:owner/status', async (request) => {
  const owner = requireOwner((request.params as { owner: string }).owner);
  return { sync: await syncStatus(owner) };
});

app.get('/v1/portfolio', async (request) => {
  const owner = requireOwner((request.query as { owner?: string }).owner);
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
        positionsWithAvailable: positions.filter((p) => p.availableQuantity !== null && Rational.fromDecimal(p.availableQuantity).compare(Rational.ZERO) > 0).length,
      },
      usdcReceived: { usd: '0', reason: CONVERSION_NOT_ENABLED },
    },
    positions,
  };
});

app.get('/v1/income', async (request) => {
  const q = request.query as { owner?: string; limit?: string; offset?: string };
  const owner = requireOwner(q.owner);
  const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50) || 50));
  const offset = Math.max(0, Number(q.offset ?? 0) || 0);
  const { rows } = await db.query(
    `SELECT e.id, e.kind, e.effective_unix, e.quantity_num, e.quantity_den, e.split_factor_num, e.split_factor_den,
            e.usd, e.valuation, e.warnings, e.reasons, p.mint, a.symbol, a.decimals
       FROM income_entries e JOIN position_epochs p ON p.id = e.position_epoch_id JOIN assets a ON a.mint = p.mint
      WHERE p.owner = $1
      ORDER BY e.effective_unix DESC, e.id DESC
      LIMIT $2 OFFSET $3`,
    [owner, limit + 1, offset],
  );
  const entries = rows.slice(0, limit).map((r) => {
    const quantityRational = Rational.of(BigInt(r.quantity_num), BigInt(r.quantity_den));
    const entry = {
      id: String(r.id),
      mint: r.mint,
      symbol: r.symbol,
      kind: r.kind,
      effectiveAt: iso(r.effective_unix),
      quantity: exact(quantityRational),
      quantityDisplay: towardZero(quantityRational, Number(r.decimals)),
      splitFactor: r.split_factor_num === null ? null : exact(Rational.of(BigInt(r.split_factor_num), BigInt(r.split_factor_den))),
      usd: r.usd === null ? null : exact(Rational.fromDecimal(r.usd)),
      valuation: r.valuation,
      warnings: r.warnings as string[],
      reasons: r.reasons as string[],
    };
    return { ...entry, headline: describeEntry(entry) };
  });
  return { owner, entries, nextOffset: rows.length > limit ? offset + limit : null };
});

app.get('/v1/income/:id', async (request) => {
  const id = (request.params as { id: string }).id;
  if (!/^\d+$/.test(id)) throw new HttpError(400, 'id must be numeric');
  const owner = requireOwner((request.query as { owner?: string }).owner);
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
  const quantityRational = Rational.of(BigInt(r.quantity_num), BigInt(r.quantity_den));
  const base = {
    kind: r.kind,
    quantity: exact(quantityRational),
    quantityDisplay: towardZero(quantityRational, Number(r.decimals)),
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
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
