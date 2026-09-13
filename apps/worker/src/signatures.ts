import type { Queryable } from '@corpact/db';
import type { SignatureInfo } from '@corpact/solana';
import type { Context } from './context';

const PAGE = 1000;

interface CursorState {
  newest?: string;
  oldest?: string;
  oldestUnix?: string;
  complete?: boolean;
}

export interface SignatureCoverage {
  /** Paged all the way back to the address's first transaction. */
  complete: boolean;
  /** Stopped at the configured cap; older history was not fetched. */
  truncated: boolean;
  count: number;
}

async function loadState(q: Queryable, stream: string): Promise<CursorState> {
  const { rows } = await q.query('SELECT state FROM sync_cursors WHERE stream = $1', [stream]);
  return (rows[0]?.state as CursorState | undefined) ?? {};
}

async function saveState(q: Queryable, stream: string, state: CursorState): Promise<void> {
  await q.query(
    `INSERT INTO sync_cursors (stream, state, history_complete) VALUES ($1, $2, $3)
     ON CONFLICT (stream) DO UPDATE SET state = EXCLUDED.state, history_complete = EXCLUDED.history_complete, updated_at = now()`,
    [stream, JSON.stringify(state), state.complete ?? false],
  );
}

async function insertPage(q: Queryable, forAddress: string, page: readonly SignatureInfo[]): Promise<void> {
  if (page.length === 0) return;
  await q.query(
    `INSERT INTO address_signatures (address, signature, slot, block_time_unix, failed)
     SELECT $1, * FROM unnest($2::text[], $3::numeric[], $4::bigint[], $5::boolean[])
     ON CONFLICT DO NOTHING`,
    [
      forAddress,
      page.map((s) => s.signature),
      page.map((s) => s.slot.toString()),
      page.map((s) => (s.blockTime === null ? null : s.blockTime.toString())),
      page.map((s) => s.failed),
    ],
  );
}

/**
 * Bring the stored signature index for an address up to date: new signatures since
 * the last run, then older ones until the history is exhausted, `sinceUnix` is
 * covered, or `maxSignatures` is reached. Resumable; progress is saved per page.
 */
export async function ensureSignatures(
  ctx: Context,
  forAddress: string,
  options: { sinceUnix?: bigint; maxSignatures?: number } = {},
): Promise<SignatureCoverage> {
  const stream = `signatures:${forAddress}`;
  const state = await loadState(ctx.db, stream);

  if (state.newest) {
    let before: string | undefined;
    let newestSeen: string | undefined;
    for (;;) {
      const page = await ctx.chain.signaturesPage(forAddress, { before, limit: PAGE });
      if (page.length === 0) break;
      newestSeen ??= page[0]!.signature;
      const known = page.findIndex((s) => s.signature === state.newest);
      await insertPage(ctx.db, forAddress, known === -1 ? page : page.slice(0, known));
      if (known !== -1 || page.length < PAGE) break;
      before = page.at(-1)!.signature;
    }
    if (newestSeen) state.newest = newestSeen;
    await saveState(ctx.db, stream, state);
  }

  const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM address_signatures WHERE address = $1', [forAddress]);
  let count: number = rows[0].n;
  let truncated = false;

  while (!state.complete) {
    if (options.sinceUnix !== undefined && state.oldestUnix !== undefined && BigInt(state.oldestUnix) < options.sinceUnix) break;
    if (options.maxSignatures !== undefined && count >= options.maxSignatures) {
      truncated = true;
      break;
    }
    const page = await ctx.chain.signaturesPage(forAddress, { before: state.oldest, limit: PAGE });
    await insertPage(ctx.db, forAddress, page);
    if (!state.newest && page[0]) state.newest = page[0].signature;
    const last = page.at(-1);
    if (last) {
      state.oldest = last.signature;
      if (last.blockTime !== null) state.oldestUnix = last.blockTime.toString();
    }
    if (page.length < PAGE) state.complete = true;
    count += page.length;
    await saveState(ctx.db, stream, state);
  }

  return { complete: state.complete ?? false, truncated, count };
}

/** Successful signatures for an address, oldest first. */
export async function storedSignatures(q: Queryable, forAddress: string): Promise<string[]> {
  const { rows } = await q.query(
    'SELECT signature FROM address_signatures WHERE address = $1 AND NOT failed ORDER BY slot, signature',
    [forAddress],
  );
  return rows.map((r) => r.signature as string);
}
