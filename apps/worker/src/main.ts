import { claimJob, completeJob, enqueueJob, failJob, migrate } from '@corpact/db';
import { createContext, type Context } from './context';
import { backfillMintWrites, classifyTransitions, importIssuerActions, rebuildTimeline } from './multiplier';
import { rebuildPositions } from './positions';
import { pollMintState, syncAssetRegistry } from './registry';
import { syncWallet } from './wallet';

const JOB_LEASE_MS = 60 * 60 * 1000;

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

async function runLoop(ctx: Context) {
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      ctx.log('info', 'stopping after current job', { signal });
      stopping = true;
    });
  }
  await migrate(ctx.db);
  let nextPoll = 0;
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
  }
}

const USAGE = `usage: worker <command>
  migrate                 apply database migrations
  sync-registry           admit issuer assets and verify mints on chain
  import-issuer-actions   one-shot import of corporate actions from ISSUER_SOURCE (default: fixtures)
  sync-wallet <owner>     historical sync and position rebuild for one wallet, in the foreground
  run                     persistent worker: job queue + chain-only mint polling`;

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!command || !['migrate', 'sync-registry', 'import-issuer-actions', 'sync-wallet', 'run'].includes(command)) {
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
