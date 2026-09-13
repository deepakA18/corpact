import { insertObservation, withTransaction, type Queryable } from '@corpact/db';
import { parseTransaction, toStorablePayload, type ParsedTransaction } from '@corpact/solana';
import type { Context } from './context';

export type StoredTransaction =
  | { status: 'ok'; parsed: ParsedTransaction }
  | { status: 'missing'; signature: string }
  | { status: 'invalid'; signature: string; error: string };

/**
 * Return a parsed transaction, fetching and storing it on first sight. The raw payload,
 * its multiplier writes and its allowlisted balance movements commit together.
 */
export async function loadOrFetchTransaction(ctx: Context, signature: string, allowlist: ReadonlySet<string>): Promise<StoredTransaction> {
  const { rows } = await ctx.db.query(
    `SELECT payload FROM chain_observations WHERE kind = 'transaction' AND signature = $1 AND subject = ''`,
    [signature],
  );
  if (rows[0]) {
    try {
      return { status: 'ok', parsed: parseTransaction(rows[0].payload) };
    } catch (err) {
      return { status: 'invalid', signature, error: String(err) };
    }
  }

  const raw = await ctx.chain.transaction(signature);
  if (raw === null) return { status: 'missing', signature };
  const payload = toStorablePayload(raw);
  let parsed: ParsedTransaction;
  try {
    parsed = parseTransaction(payload);
  } catch (err) {
    return { status: 'invalid', signature, error: String(err) };
  }

  await withTransaction(ctx.db, async (client) => {
    const observationId = await insertObservation(client, {
      kind: 'transaction',
      signature,
      slot: parsed.slot,
      blockTimeUnix: parsed.blockTime,
      payload,
    });
    for (const w of parsed.multiplierWrites) {
      if (!allowlist.has(w.mint)) continue;
      await client.query(
        `INSERT INTO multiplier_writes (mint, signature, slot, instruction_path, clock_unix, kind, multiplier_bits, effective_unix, observation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (signature, instruction_path) DO NOTHING`,
        [w.mint, signature, parsed.slot.toString(), w.cursor.instructionPath, w.clockUnix.toString(), w.kind, w.multiplierBits, w.effectiveUnix.toString(), observationId],
      );
    }
    for (const c of parsed.balanceChanges) {
      if (!allowlist.has(c.mint)) continue;
      await client.query(
        `INSERT INTO balance_movements (signature, slot, block_time_unix, account, mint, owner_before, owner_after, raw_before, raw_after, reason, observation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (signature, account) DO NOTHING`,
        [signature, parsed.slot.toString(), parsed.blockTime.toString(), c.account, c.mint, c.ownerBefore, c.ownerAfter, c.rawBefore.toString(), c.rawAfter.toString(), c.reason, observationId],
      );
      await upsertTokenAccount(client, c.account, c.mint, c.tokenProgram, parsed.slot, c.reason === 'close');
    }
  });

  return { status: 'ok', parsed };
}

async function upsertTokenAccount(q: Queryable, account: string, mint: string, program: string | null, slot: bigint, closed: boolean) {
  await q.query(
    `INSERT INTO token_accounts (address, mint, token_program, first_seen_slot, last_seen_slot, closed_slot)
     VALUES ($1, $2, $3, $4, $4, CASE WHEN $5::boolean THEN $4::numeric END)
     ON CONFLICT (address) DO UPDATE SET
       first_seen_slot = LEAST(token_accounts.first_seen_slot, EXCLUDED.first_seen_slot),
       last_seen_slot  = GREATEST(token_accounts.last_seen_slot, EXCLUDED.last_seen_slot),
       closed_slot     = CASE WHEN $5::boolean THEN GREATEST(COALESCE(token_accounts.closed_slot, 0), EXCLUDED.last_seen_slot)
                              ELSE token_accounts.closed_slot END,
       token_program   = COALESCE(token_accounts.token_program, EXCLUDED.token_program),
       updated_at      = now()`,
    [account, mint, program, slot.toString(), closed],
  );
}

/** Resolve intra-slot order for the given slots from getBlock, storing only transactions we have observed. */
export async function resolveTransactionOrder(ctx: Context, slots: readonly bigint[]): Promise<void> {
  for (const slot of slots) {
    const { rows } = await ctx.db.query(`SELECT DISTINCT signature FROM chain_observations WHERE kind = 'transaction' AND slot = $1`, [slot.toString()]);
    const wanted = new Set(rows.map((r) => r.signature as string));
    if (wanted.size < 2) continue;
    const ordered = await ctx.chain.blockSignatures(slot);
    const found = ordered.map((signature, txIndex) => ({ signature, txIndex })).filter((e) => wanted.has(e.signature));
    if (found.length !== wanted.size) {
      ctx.log('warn', 'block is missing observed transactions', { slot, wanted: wanted.size, found: found.length });
    }
    await ctx.db.query(
      `INSERT INTO transaction_indexes (signature, slot, tx_index)
       SELECT signature, $1, tx_index FROM unnest($2::text[], $3::int[]) AS t(signature, tx_index)
       ON CONFLICT (signature) DO NOTHING`,
      [slot.toString(), found.map((e) => e.signature), found.map((e) => e.txIndex)],
    );
  }
}
