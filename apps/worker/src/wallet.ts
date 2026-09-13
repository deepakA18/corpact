import { TOKEN_2022_PROGRAM, isAddress } from '@corpact/solana';
import type { Context } from './context';
import { backfillMintWrites, classifyTransitions, rebuildTimeline } from './multiplier';
import { rebuildPositions } from './positions';
import { loadAllowlist } from './registry';
import { ensureSignatures, storedSignatures } from './signatures';
import { loadOrFetchTransaction } from './transactions';

async function setProgress(ctx: Context, owner: string, progress: Record<string, unknown>) {
  await ctx.db.query('UPDATE wallet_syncs SET progress = $2 WHERE owner = $1', [owner, JSON.stringify(progress)]);
}

/**
 * Historical sync for one wallet (PLAN §5.4): discover every supported token account it
 * ever owned, replay each account's full history, reconstruct the multiplier timeline for
 * the mints involved, classify, and rebuild positions.
 */
export async function syncWallet(ctx: Context, owner: string) {
  if (!isAddress(owner)) throw new Error(`Not a valid Solana address: ${owner}`);
  await ctx.db.query(
    `INSERT INTO wallet_syncs (owner, status, started_at) VALUES ($1, 'running', now())
     ON CONFLICT (owner) DO UPDATE SET status = 'running', started_at = now(), finished_at = NULL, error = NULL, progress = '{}'`,
    [owner],
  );
  const gaps: string[] = [];
  let fetched = 0;

  try {
    const allowlist = await loadAllowlist(ctx.db);
    if (allowlist.size === 0) throw new Error('The asset registry is empty; run sync-registry first');

    const inventory = await ctx.chain.tokenAccountsByOwner(owner, TOKEN_2022_PROGRAM);
    const accounts = new Map(inventory.accounts.filter((a) => allowlist.has(a.mint)).map((a) => [a.address as string, a.mint as string]));

    await setProgress(ctx, owner, { phase: 'wallet signatures' });
    const ownerCoverage = await ensureSignatures(ctx, owner, { maxSignatures: ctx.config.walletMaxSignatures });
    if (ownerCoverage.truncated) {
      gaps.push(`Wallet history was truncated at ${ownerCoverage.count} transactions; older token accounts may be missing`);
    }

    const ownerSignatures = await storedSignatures(ctx.db, owner);
    for (const [i, signature] of ownerSignatures.entries()) {
      const tx = await loadOrFetchTransaction(ctx, signature, allowlist);
      fetched++;
      if (tx.status !== 'ok') {
        gaps.push(tx.status === 'missing' ? `Transaction ${signature} is unavailable from the RPC provider` : `Transaction ${signature} could not be decoded: ${tx.error}`);
        continue;
      }
      for (const c of tx.parsed.balanceChanges) {
        if (allowlist.has(c.mint) && (c.ownerBefore === owner || c.ownerAfter === owner)) accounts.set(c.account, c.mint);
      }
      if (i % 25 === 0) await setProgress(ctx, owner, { phase: 'discovering token accounts', done: i + 1, total: ownerSignatures.length });
    }

    let accountIndex = 0;
    for (const account of accounts.keys()) {
      accountIndex++;
      await setProgress(ctx, owner, { phase: 'token account histories', done: accountIndex, total: accounts.size });
      const coverage = await ensureSignatures(ctx, account);
      for (const signature of await storedSignatures(ctx.db, account)) {
        const tx = await loadOrFetchTransaction(ctx, signature, allowlist);
        fetched++;
        if (tx.status !== 'ok') {
          gaps.push(tx.status === 'missing' ? `Transaction ${signature} on ${account} is unavailable` : `Transaction ${signature} on ${account} could not be decoded: ${tx.error}`);
          continue;
        }
        const touches = tx.parsed.balanceChanges.some((c) => c.account === account);
        for (const anomaly of touches ? tx.parsed.anomalies : []) gaps.push(`${signature}: ${anomaly}`);
      }
      await ctx.db.query('UPDATE token_accounts SET history_complete = $2, updated_at = now() WHERE address = $1', [account, coverage.complete]);
    }

    const mints = [...new Set(accounts.values())];
    for (const [i, mint] of mints.entries()) {
      await setProgress(ctx, owner, { phase: 'multiplier history', done: i + 1, total: mints.length });
      await backfillMintWrites(ctx, mint);
      await rebuildTimeline(ctx, mint);
      await classifyTransitions(ctx, mint);
    }

    await ctx.db.query('UPDATE wallet_syncs SET gaps = $2, transactions_fetched = $3 WHERE owner = $1', [owner, JSON.stringify(gaps), fetched]);
    await setProgress(ctx, owner, { phase: 'rebuilding positions' });
    const positions = await rebuildPositions(ctx, owner);
    const clock = await ctx.chain.finalizedClock();

    await ctx.db.query(
      `UPDATE wallet_syncs SET status = $2, finished_at = now(), as_of_slot = $3, as_of_unix = $4, progress = '{}' WHERE owner = $1`,
      [owner, gaps.length === 0 ? 'complete' : 'partial', clock.slot.toString(), clock.unixTime.toString()],
    );
    return { accounts: accounts.size, transactions: fetched, gaps: gaps.length, positions };
  } catch (err) {
    await ctx.db.query(
      `UPDATE wallet_syncs SET status = 'failed', finished_at = now(), error = $2, gaps = $3, transactions_fetched = $4 WHERE owner = $1`,
      [owner, err instanceof Error ? `${err.name}: ${err.message}` : String(err), JSON.stringify(gaps), fetched],
    );
    throw err;
  }
}
