import { claimJob, collectSnapshot, completeJob, enqueueJob, evaluateChecks, failJob, migrate, verifyIntegrity } from '@corpact/db';
import { createContext, type Context } from './context';
import { backfillMintWrites, classifyTransitions, importIssuerActions, rebuildTimeline } from './multiplier';
import { rebuildPositions } from './positions';
import { pollMintState, syncAssetRegistry } from './registry';
import { syncWallet } from './wallet';

const JOB_LEASE_MS = 60 * 60 * 1000;
const HEARTBEAT_MS = 15_000;

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value === '') throw new Error(`Job payload is missing "${key}"`);
  return value;
}

/**
 * Scheduled and queued work. Note what is absent: issuer imports never run here —
 * they are one-shot CLI commands, so no steady-state loop polls the issuer feed.
 */
const handlers: Record<string, (ctx: Context, payload: Record<string, unknown>) => Promise<unknown>> = {
  poll_mint_state: (ctx) => pollMintState(ctx),
  backfill_mint_writes: (ctx, p) =>
    backfillMintWrites(ctx, requireString(p, 'mint'), Array.isArray(p.hints) ? p.hints.map((h) => BigInt(String(h))) : []),
  rebuild_timeline: (ctx, p) => rebuildTimeline(ctx, requireString(p, 'mint')),
  classify_transitions: (ctx, p) => classifyTransitions(ctx, requireString(p, 'mint')),
  sync_wallet: (ctx, p) => syncWallet(ctx, requireString(p, 'owner')),
  rebuild_positions: (ctx, p) => rebuildPositions(ctx, requireString(p, 'owner')),
};

function heartbeat(ctx: Context, startedAt: Date, lastJobKind: string | null) {
  const stats = ctx.chain.stats();
  return ctx.db.query(
    `INSERT INTO worker_heartbeats (worker_id, started_at, last_seen_at, last_job_kind, last_job_at, mint_poll_seconds, rpc_host,
                                    rpc_requests, rpc_retries, rpc_failures, reconciliation_rpc_host)
     VALUES ($1, $2, now(), $3, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (worker_id) DO UPDATE SET
       last_seen_at = now(),
       last_job_kind = COALESCE(EXCLUDED.last_job_kind, worker_heartbeats.last_job_kind),
       last_job_at = COALESCE(EXCLUDED.last_job_at, worker_heartbeats.last_job_at),
       rpc_requests = EXCLUDED.rpc_requests, rpc_retries = EXCLUDED.rpc_retries, rpc_failures = EXCLUDED.rpc_failures,
       reconciliation_rpc_host = EXCLUDED.reconciliation_rpc_host`,
    [
      ctx.config.workerId, startedAt, lastJobKind, ctx.config.mintPollSeconds, new URL(ctx.config.rpcUrl).host,
      stats.requests, stats.retries, stats.failures,
      ctx.config.reconciliationRpcUrl === null ? null : new URL(ctx.config.reconciliationRpcUrl).host,
    ],
  );
}

async function runLoop(ctx: Context) {
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      ctx.log('info', 'stopping after current job', { signal });
      stopping = true;
    });
  }
  await migrate(ctx.db);

  // On a timer, so a long job (a wallet backfill on a slow RPC) is not mistaken for a dead worker.
  const startedAt = new Date();
  const beat = () => heartbeat(ctx, startedAt, null).catch((error: unknown) => ctx.log('warn', 'heartbeat failed', { error }));
  await beat();
  const timer = setInterval(beat, HEARTBEAT_MS);
  timer.unref();

  let nextPoll = 0;
  try {
    while (!stopping) {
      if (Date.now() >= nextPoll) {
        await enqueueJob(ctx.db, { kind: 'poll_mint_state', businessKey: 'poll_mint_state' });
        nextPoll = Date.now() + ctx.config.mintPollSeconds * 1000;
      }
      const job = await claimJob(ctx.db, ctx.config.workerId, JOB_LEASE_MS);
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      const started = Date.now();
      try {
        const handler = handlers[job.kind];
        if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
        await handler(ctx, job.payload);
        await completeJob(ctx.db, job, ctx.config.workerId);
        ctx.log('info', 'job done', { kind: job.kind, key: job.businessKey, ms: Date.now() - started });
      } catch (error) {
        const outcome = await failJob(ctx.db, job, ctx.config.workerId, error);
        ctx.log('error', 'job failed', { kind: job.kind, key: job.businessKey, attempt: job.attempts, outcome, error });
      }
      await heartbeat(ctx, startedAt, job.kind).catch((error: unknown) => ctx.log('warn', 'heartbeat failed', { error }));
    }
  } finally {
    clearInterval(timer);
  }
}

const COMMANDS = ['migrate', 'sync-registry', 'import-issuer-actions', 'sync-wallet', 'check', 'verify-integrity', 'run'];

const USAGE = `usage: worker <command>
  migrate                 apply database migrations
  sync-registry           admit issuer assets and verify mints on chain
  import-issuer-actions   one-shot import of corporate actions from ISSUER_SOURCE (default: fixtures)
  sync-wallet <owner>     historical sync and position rebuild for one wallet, in the foreground
  check                   evaluate monitoring checks; exits 1 if any is critical
  verify-integrity        check evidence hashes, append-only guards and journal invariants (read-only; exits 1 on failure)
  run                     persistent worker: job queue + chain-only mint polling`;

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!command || !COMMANDS.includes(command)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const ctx = createContext();
  try {
    switch (command) {
      case 'migrate':
        console.log(JSON.stringify({ applied: await migrate(ctx.db) }));
        break;
      case 'sync-registry':
        await migrate(ctx.db);
        console.log(JSON.stringify(await syncAssetRegistry(ctx)));
        break;
      case 'import-issuer-actions':
        await migrate(ctx.db);
        console.log(JSON.stringify(await importIssuerActions(ctx)));
        break;
      case 'sync-wallet':
        if (!arg) throw new Error('sync-wallet needs an owner address');
        await migrate(ctx.db);
        console.log(JSON.stringify(await syncWallet(ctx, arg), (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2));
        break;
      case 'check': {
        const result = evaluateChecks(await collectSnapshot(ctx.db));
        console.log(JSON.stringify(result, null, 2));
        if (result.status === 'critical') process.exitCode = 1;
        break;
      }
      case 'verify-integrity': {
        // Deliberately no migrate first: a restored copy is checked exactly as it is.
        const results = await verifyIntegrity(ctx.db);
        for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}`);
        if (results.some((r) => !r.ok)) process.exitCode = 1;
        break;
      }
      case 'run':
        await runLoop(ctx);
        break;
    }
  } finally {
    await ctx.db.end();
  }
}

main().catch((error: unknown) => {
  // Name and message only: provider errors can carry the request URL, and with it an API key.
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
