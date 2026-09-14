import { enqueueJob, insertObservation, sha256Hex, withTransaction, type Queryable } from '@corpact/db';
import { TOKEN_2022_PROGRAM, decodeToken2022Mint, type DecodedMint } from '@corpact/solana';
import type { Context } from './context';
import { crossCheckMints } from './crosscheck';

type MintAccount = { owner: string; data: Uint8Array } | null;

function verifyMint(account: MintAccount): { decoded: DecodedMint; error: null } | { decoded: null; error: string } {
  if (account === null) return { decoded: null, error: 'Mint account does not exist' };
  if (account.owner !== TOKEN_2022_PROGRAM) return { decoded: null, error: `Owned by ${account.owner}, not Token-2022` };
  try {
    const decoded = decodeToken2022Mint(account.data);
    if (!decoded.isInitialized) return { decoded: null, error: 'Mint is not initialized' };
    if (!decoded.scaledUiAmount) return { decoded: null, error: 'Mint has no ScaledUiAmount extension' };
    return { decoded, error: null };
  } catch (err) {
    return { decoded: null, error: String(err) };
  }
}

/** Store mint account bytes only when they changed since the last observation. */
async function recordMintState(q: Queryable, mint: string, slot: bigint, account: NonNullable<MintAccount>): Promise<boolean> {
  const payload = { owner: account.owner, data: Buffer.from(account.data).toString('base64') };
  const { rows } = await q.query(
    `SELECT payload_sha256 FROM chain_observations WHERE kind = 'mint_state' AND subject = $1 ORDER BY slot DESC, id DESC LIMIT 1`,
    [mint],
  );
  if (rows[0]?.payload_sha256 === sha256Hex(JSON.stringify(payload))) return false;
  await insertObservation(q, { kind: 'mint_state', subject: mint, slot, payload });
  return true;
}

/**
 * Admit assets from the issuer registry (recorded fixtures by default) and verify each
 * mint live on chain. Identity is the mint address; symbols are display only.
 */
export async function syncAssetRegistry(ctx: Context): Promise<{ verified: number; failed: number }> {
  let assets = await ctx.issuer.listSolanaAssets();
  if (ctx.config.allowlistSymbols) {
    const allowed = new Set(ctx.config.allowlistSymbols);
    assets = assets.filter((a) => allowed.has(a.symbol));
  }
  const { slot, accounts } = await ctx.chain.accounts(assets.map((a) => a.mint));
  let verified = 0;
  let failed = 0;

  await withTransaction(ctx.db, async (client) => {
    for (const a of assets) {
      const account = accounts.get(a.mint) ?? null;
      const { decoded, error } = verifyMint(account);
      if (account) await recordMintState(client, a.mint, slot, account);
      if (error) failed++;
      else verified++;
      await client.query(
        `INSERT INTO assets (mint, issuer, symbol, name, underlying_symbol, registry_source, token_program, decimals,
                             extension_types, scaled_ui_authority, verified_slot, verification_error, updated_at)
         VALUES ($1, 'xstocks', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT (mint) DO UPDATE SET
           symbol = EXCLUDED.symbol, name = EXCLUDED.name, underlying_symbol = EXCLUDED.underlying_symbol,
           registry_source = EXCLUDED.registry_source, token_program = EXCLUDED.token_program, decimals = EXCLUDED.decimals,
           extension_types = EXCLUDED.extension_types, scaled_ui_authority = EXCLUDED.scaled_ui_authority,
           verified_slot = EXCLUDED.verified_slot, verification_error = EXCLUDED.verification_error, updated_at = now()`,
        [
          a.mint,
          a.symbol,
          a.name,
          a.underlyingSymbol,
          ctx.issuer.kind,
          account?.owner ?? null,
          decoded?.decimals ?? null,
          decoded?.extensionTypes ?? null,
          decoded?.scaledUiAmount?.authority ?? null,
          slot.toString(),
          error,
        ],
      );
    }
  });
  ctx.log('info', 'asset registry synced', { verified, failed, source: ctx.issuer.kind });
  return { verified, failed };
}

/**
 * Chain-only reconciliation fallback (PLAN §5.2 step 1). For mints held by tracked wallets:
 * record config changes, fetch writes the mint stores but we have not seen, and settle
 * scheduled activations whose time has passed — none of which needs an account write.
 */
export async function pollMintState(ctx: Context): Promise<void> {
  const { rows } = await ctx.db.query(
    `SELECT a.mint FROM assets a
      WHERE a.verification_error IS NULL
        AND EXISTS (SELECT 1 FROM balance_movements m WHERE m.mint = a.mint)`,
  );
  const clock = await ctx.chain.finalizedClock();
  if (rows.length === 0) {
    await recordMintPoll(ctx.db, clock, 0);
    return;
  }
  const mints = rows.map((r) => r.mint as string);
  const { slot, accounts } = await ctx.chain.accounts(mints);

  if (ctx.reconciler) {
    // Cross-check the mints someone holds a position in: that is where a wrong multiplier changes a number.
    const { rows: held } = await ctx.db.query('SELECT DISTINCT mint FROM position_epochs');
    const heldMints = held.map((r) => r.mint as string).filter((m) => accounts.has(m));
    const changed = await crossCheckMints(ctx, heldMints, { slot, accounts });
    if (changed.length > 0) {
      // A disagreement appearing or clearing changes which positions may convert.
      const { rows: owners } = await ctx.db.query('SELECT DISTINCT owner FROM position_epochs WHERE mint = ANY($1)', [changed]);
      for (const { owner } of owners) {
        await enqueueJob(ctx.db, { kind: 'rebuild_positions', businessKey: `rebuild_positions:${owner}`, payload: { owner } });
      }
    }
  }

  for (const mint of mints) {
    const { decoded, error } = verifyMint(accounts.get(mint) ?? null);
    if (error || !decoded?.scaledUiAmount) {
      ctx.log('error', 'tracked mint failed verification', { mint, error });
      continue;
    }
    const cfg = decoded.scaledUiAmount;
    await withTransaction(ctx.db, async (client) => {
      await recordMintState(client, mint, slot, accounts.get(mint)!);
      const seen = await client.query(
        `SELECT 1 FROM multiplier_writes WHERE mint = $1 AND multiplier_bits = $2 AND effective_unix = $3 LIMIT 1`,
        [mint, cfg.newMultiplierBits, cfg.newMultiplierEffectiveTimestamp.toString()],
      );
      if (!seen.rowCount && cfg.newMultiplierEffectiveTimestamp > 0n) {
        await enqueueJob(client, {
          kind: 'backfill_mint_writes',
          businessKey: `backfill_mint_writes:${mint}:${cfg.newMultiplierEffectiveTimestamp}`,
          payload: { mint, hints: [cfg.newMultiplierEffectiveTimestamp.toString()] },
        });
      }
      const due = await client.query(
        `SELECT 1 FROM multiplier_versions WHERE mint = $1 AND status = 'scheduled' AND effective_unix <= $2 LIMIT 1`,
        [mint, clock.unixTime.toString()],
      );
      if (due.rowCount) {
        await enqueueJob(client, { kind: 'rebuild_timeline', businessKey: `rebuild_timeline:${mint}`, payload: { mint } });
      }
    });
  }
  await recordMintPoll(ctx.db, clock, mints.length);
}

/** Freshness and finalized-clock lag of the chain-only poll, read by monitoring. */
async function recordMintPoll(q: Queryable, clock: { slot: bigint; unixTime: bigint }, mints: number) {
  await q.query(
    `INSERT INTO sync_cursors (stream, finalized_slot, state) VALUES ('mint-poll', $1, $2)
     ON CONFLICT (stream) DO UPDATE SET finalized_slot = EXCLUDED.finalized_slot, state = EXCLUDED.state, updated_at = now()`,
    [
      clock.slot.toString(),
      JSON.stringify({ polledUnix: Math.floor(Date.now() / 1000), clockUnix: Number(clock.unixTime), slot: clock.slot.toString(), mints }),
    ],
  );
}

export async function loadAllowlist(q: Queryable): Promise<Set<string>> {
  const { rows } = await q.query(`SELECT mint FROM assets WHERE verification_error IS NULL AND decimals IS NOT NULL`);
  return new Set(rows.map((r) => r.mint as string));
}
