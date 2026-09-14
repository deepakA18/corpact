import { classifyTransition } from '@corpact/accounting';
import { enqueueJob, sha256Hex, withTransaction, type Queryable } from '@corpact/db';
import { Rational, type Classification, type IssuerCorporateAction } from '@corpact/domain';
import {
  buildMultiplierTimeline,
  decodeToken2022Mint,
  float64FromBits,
  verifyTimelineAgainstMint,
  type Address,
  type MultiplierWrite,
  type ScaledUiAmountConfig,
} from '@corpact/solana';
import { isoOf, unixOf, type Context } from './context';
import { hintSatisfied } from './hints';
import { matchColumns, sameInterpretation, storedMatchFromRow } from './interpretation';
import { loadAllowlist } from './registry';
import { ensureSignatures } from './signatures';
import { loadOrFetchTransaction, resolveTransactionOrder } from './transactions';

/** Recorded on each match. Bumping it alone writes nothing new; only a changed outcome supersedes a match. */
export const CLASSIFIER_VERSION = 'classify-v2';

// Issuer corporate-action records are created seconds to minutes before the chain write (UNHx: 3 s).
const NARROW_BEFORE = 600n;
const NARROW_AFTER = 1800n;
// Without a creation time, the write lands ahead of the activation it schedules.
const WIDE_BEFORE = 36n * 3600n;
const WIDE_AFTER = 600n;

const timelineStream = (mint: string) => `multiplier-timeline:${mint}`;
const exactDecimal = (bits: string) => Rational.fromFloat64(float64FromBits(bits)).toTerminatingDecimal();

const FAR_FUTURE = 1n << 62n;

async function latestMintState(q: Queryable, mint: string): Promise<{ slot: bigint; config: ScaledUiAmountConfig | null } | null> {
  const { rows } = await q.query(
    `SELECT slot, payload FROM chain_observations WHERE kind = 'mint_state' AND subject = $1 ORDER BY slot DESC, id DESC LIMIT 1`,
    [mint],
  );
  if (!rows[0]) return null;
  return {
    slot: BigInt(rows[0].slot),
    config: decodeToken2022Mint(new Uint8Array(Buffer.from(rows[0].payload.data, 'base64'))).scaledUiAmount,
  };
}

/** Stored writes for a mint, with intra-slot order resolved wherever two transactions share a slot. */
async function loadWrites(ctx: Context, mint: string): Promise<MultiplierWrite[]> {
  const ambiguous = await ctx.db.query(
    `SELECT w.slot FROM multiplier_writes w LEFT JOIN transaction_indexes ti ON ti.signature = w.signature
      WHERE w.mint = $1 AND ti.tx_index IS NULL
      GROUP BY w.slot HAVING count(DISTINCT w.signature) > 1`,
    [mint],
  );
  await resolveTransactionOrder(ctx, ambiguous.rows.map((r) => BigInt(r.slot)));
  const { rows } = await ctx.db.query(
    `SELECT w.signature, w.slot, ti.tx_index, w.instruction_path, w.clock_unix, w.kind, w.multiplier_bits, w.effective_unix
       FROM multiplier_writes w LEFT JOIN transaction_indexes ti ON ti.signature = w.signature
      WHERE w.mint = $1`,
    [mint],
  );
  return rows.map((r) => ({
    mint: mint as Address,
    signature: r.signature,
    cursor: { slot: BigInt(r.slot), txIndex: r.tx_index ?? null, instructionPath: r.instruction_path },
    clockUnix: BigInt(r.clock_unix),
    kind: r.kind,
    multiplierBits: r.multiplier_bits,
    effectiveUnix: BigInt(r.effective_unix),
  }));
}

async function mergeCursorState(q: Queryable, stream: string, patch: Record<string, unknown>): Promise<void> {
  await q.query(
    `INSERT INTO sync_cursors (stream, state) VALUES ($1, $2)
     ON CONFLICT (stream) DO UPDATE SET state = sync_cursors.state || EXCLUDED.state, updated_at = now()`,
    [stream, JSON.stringify(patch)],
  );
}

function mergeWindows(windows: ReadonlyArray<readonly [bigint, bigint]>): Array<[bigint, bigint]> {
  const sorted = windows.toSorted((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const merged: Array<[bigint, bigint]> = [];
  for (const [lo, hi] of sorted) {
    const last = merged.at(-1);
    if (last && lo <= last[1]) last[1] = hi > last[1] ? hi : last[1];
    else merged.push([lo, hi]);
  }
  return merged;
}

async function scanAuthorityWindows(
  ctx: Context,
  authority: string,
  windows: ReadonlyArray<readonly [bigint, bigint]>,
  allowlist: ReadonlySet<string>,
): Promise<void> {
  const merged = mergeWindows(windows);
  if (merged.length === 0) return;
  await ensureSignatures(ctx, authority, { sinceUnix: merged[0]![0] });
  for (const [lo, hi] of merged) {
    const { rows } = await ctx.db.query(
      `SELECT s.signature FROM address_signatures s
        WHERE s.address = $1 AND NOT s.failed AND s.block_time_unix BETWEEN $2 AND $3
          AND NOT EXISTS (SELECT 1 FROM chain_observations o WHERE o.kind = 'transaction' AND o.signature = s.signature AND o.subject = '')
        ORDER BY s.slot`,
      [authority, lo.toString(), hi.toString()],
    );
    for (const { signature } of rows) {
      const result = await loadOrFetchTransaction(ctx, signature, allowlist);
      if (result.status !== 'ok') ctx.log('warn', 'authority transaction unavailable', { authority, ...result });
    }
  }
}

/**
 * Locate this mint's multiplier writes on chain. Windows come from the recorded issuer
 * schedule (via the issuer source) and the mint's own pending timestamp; the timeline is
 * then verified against the mint, so a write the schedule does not know about still shows.
 */
export async function backfillMintWrites(ctx: Context, mint: string, extraHints: readonly bigint[] = []) {
  const { rows } = await ctx.db.query(
    `SELECT symbol, scaled_ui_authority FROM assets WHERE mint = $1 AND verification_error IS NULL`,
    [mint],
  );
  const asset = rows[0];
  if (!asset?.scaled_ui_authority) throw new Error(`${mint} is not a verified Scaled UI mint with a multiplier authority`);
  const allowlist = await loadAllowlist(ctx.db);

  const { history } = await ctx.issuer.multiplierHistory(asset.symbol);
  const { actions } = await ctx.issuer.corporateActions('history', { symbol: asset.symbol });
  const createdByActivation = new Map<bigint, bigint>();
  for (const a of actions) {
    if (!a.effectiveAt) continue;
    const effective = unixOf(a.effectiveAt);
    const created = unixOf(a.createdAt);
    const prior = createdByActivation.get(effective);
    if (prior === undefined || created < prior) createdByActivation.set(effective, created);
  }
  const cfg = (await latestMintState(ctx.db, mint))?.config ?? null;
  const hints = new Set<bigint>([
    ...history.map((h) => unixOf(new Date(h.activationDateTime))),
    ...extraHints,
    ...(cfg && cfg.newMultiplierEffectiveTimestamp > 0n ? [cfg.newMultiplierEffectiveTimestamp] : []),
  ]);

  // Judge against the rebuilt timeline, so a late publication counts and a weeks-later re-assert does not.
  const stillMissing = async () => {
    const { transitions } = buildMultiplierTimeline(mint as Address, await loadWrites(ctx, mint), FAR_FUTURE);
    return [...hints].filter((h) => !hintSatisfied(transitions, h)).sort((a, b) => (a < b ? -1 : 1));
  };

  let missing = await stillMissing();
  await scanAuthorityWindows(
    ctx,
    asset.scaled_ui_authority,
    missing.flatMap((h) => {
      const created = createdByActivation.get(h);
      return created === undefined ? [] : [[created - NARROW_BEFORE, created + NARROW_AFTER] as const];
    }),
    allowlist,
  );
  missing = await stillMissing();
  await scanAuthorityWindows(ctx, asset.scaled_ui_authority, missing.map((h) => [h - WIDE_BEFORE, h + WIDE_AFTER] as const), allowlist);
  missing = await stillMissing();

  const backfillGaps = missing.map((h) => `No multiplier write found on chain for the scheduled activation at ${isoOf(h)}`);
  await mergeCursorState(ctx.db, timelineStream(mint), { backfillGaps });
  ctx.log('info', 'multiplier writes backfilled', { mint, symbol: asset.symbol, hints: hints.size, missing: missing.length });
  return { hints: hints.size, missing: missing.length };
}

/** Rebuild the derived timeline from stored writes, verify it against the mint, and persist versions. */
export async function rebuildTimeline(ctx: Context, mint: string) {
  const writes = await loadWrites(ctx, mint);
  const clock = await ctx.chain.finalizedClock();
  const timeline = buildMultiplierTimeline(mint as Address, writes, clock.unixTime);
  const mintState = await latestMintState(ctx.db, mint);
  const cfg = mintState?.config ?? null;
  const prior = await ctx.db.query('SELECT state FROM sync_cursors WHERE stream = $1', [timelineStream(mint)]);
  const priorState = prior.rows[0]?.state as { backfillGaps?: string[]; knownFrom?: { unixTime: string; slot: string; multiplierBits: string } | null } | undefined;

  let verification = cfg ? verifyTimelineAgainstMint(timeline, cfg) : ['No recorded mint state to verify the timeline against'];
  let knownFrom = timeline.knownFrom && {
    unixTime: timeline.knownFrom.unixTime.toString(),
    slot: timeline.knownFrom.cursor.slot.toString(),
    multiplierBits: timeline.knownFrom.multiplierBits,
  };
  if (writes.length === 0 && mintState && cfg && cfg.newMultiplierEffectiveTimestamp === 0n && cfg.multiplierBits === cfg.newMultiplierBits) {
    // Live state shows no multiplier ever scheduled. With no writes observed, the value is certain only from
    // the first observation of that state — keep the earliest one rather than moving it forward each rebuild.
    const earlier = priorState?.knownFrom;
    knownFrom =
      earlier && earlier.multiplierBits === cfg.multiplierBits
        ? earlier
        : { unixTime: clock.unixTime.toString(), slot: mintState.slot.toString(), multiplierBits: cfg.multiplierBits };
    verification = [];
  }
  const gaps: string[] = [...(priorState?.backfillGaps ?? []), ...verification];

  await withTransaction(ctx.db, async (client) => {
    for (const t of timeline.transitions) {
      const configHash = sha256Hex(
        [mint, t.updateSignature, t.observedAt.instructionPath.join('.'), t.scheduledUnix, t.oldMultiplierBits ?? '', t.newMultiplierBits].join('|'),
      );
      await client.query(
        `INSERT INTO multiplier_versions (mint, update_signature, observed_slot, observed_tx_index, observed_instruction_path,
                                          scheduled_unix, effective_unix, immediate, old_multiplier_bits, new_multiplier_bits,
                                          old_multiplier_exact, new_multiplier_exact, status, config_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (mint, update_signature, observed_instruction_path) DO UPDATE SET
           observed_tx_index = EXCLUDED.observed_tx_index, effective_unix = EXCLUDED.effective_unix, immediate = EXCLUDED.immediate,
           old_multiplier_bits = EXCLUDED.old_multiplier_bits, old_multiplier_exact = EXCLUDED.old_multiplier_exact,
           status = EXCLUDED.status, config_hash = EXCLUDED.config_hash, updated_at = now()`,
        [
          mint,
          t.updateSignature,
          t.observedAt.slot.toString(),
          t.observedAt.txIndex,
          t.observedAt.instructionPath,
          t.scheduledUnix.toString(),
          t.effectiveUnix.toString(),
          t.immediate,
          t.oldMultiplierBits,
          t.newMultiplierBits,
          t.oldMultiplierBits === null ? null : exactDecimal(t.oldMultiplierBits),
          exactDecimal(t.newMultiplierBits),
          t.status,
          configHash,
        ],
      );
      if (t.status === 'scheduled') {
        // Activation needs no account write; wake up for it from chain time.
        await enqueueJob(client, {
          kind: 'rebuild_timeline',
          businessKey: `rebuild_timeline:${mint}:${t.effectiveUnix}`,
          payload: { mint },
          runAfter: new Date(Number(t.effectiveUnix) * 1000 + 2000),
        });
      }
    }
    await client.query(
      `INSERT INTO sync_cursors (stream, state, gaps, finalized_slot, history_complete) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (stream) DO UPDATE SET state = sync_cursors.state || EXCLUDED.state, gaps = EXCLUDED.gaps,
         finalized_slot = EXCLUDED.finalized_slot, history_complete = EXCLUDED.history_complete, updated_at = now()`,
      [
        timelineStream(mint),
        JSON.stringify({ knownFrom }),
        JSON.stringify(gaps),
        clock.slot.toString(),
        gaps.length === 0,
      ],
    );
    await enqueueJob(client, { kind: 'classify_transitions', businessKey: `classify_transitions:${mint}`, payload: { mint } });
  });

  return { transitions: timeline.transitions.length, gaps };
}

export function actionFromPayload(payload: Record<string, unknown>): IssuerCorporateAction {
  const p = payload as unknown as Omit<IssuerCorporateAction, 'effectiveAt' | 'createdAt'> & { effectiveAt: string | null; createdAt: string };
  return { ...p, effectiveAt: p.effectiveAt === null ? null : new Date(p.effectiveAt), createdAt: new Date(p.createdAt) };
}

/**
 * Re-evaluate every active transition of a mint against the current issuer evidence.
 * A changed outcome supersedes the stored match (which is kept); an unchanged one writes nothing.
 */
export async function classifyTransitions(ctx: Context, mint: string): Promise<number> {
  const { rows: assetRows } = await ctx.db.query('SELECT symbol FROM assets WHERE mint = $1', [mint]);
  const symbol: string | undefined = assetRows[0]?.symbol;
  if (!symbol) throw new Error(`${mint} is not in the asset registry`);

  const { rows: actionRows } = await ctx.db.query(`SELECT payload FROM corporate_actions WHERE issuer = 'xstocks' AND symbol = $1`, [symbol]);
  const actions = actionRows.map((r) => actionFromPayload(r.payload));
  const { rows: versions } = await ctx.db.query(
    `SELECT v.id, v.old_multiplier_bits, v.new_multiplier_bits, v.scheduled_unix,
            m.id AS match_id, m.classification, m.external_id, m.revision, m.net_cash_per_share,
            m.split_factor_num, m.split_factor_den, m.reasons, m.warnings
       FROM multiplier_versions v
       LEFT JOIN action_matches m ON m.multiplier_version_id = v.id AND m.superseded_at IS NULL
      WHERE v.mint = $1 AND v.status IN ('active', 'orphaned')`,
    [mint],
  );
  if (versions.length === 0) return 0;
  let added = 0;
  let superseded = 0;

  await withTransaction(ctx.db, async (client) => {
    for (const v of versions) {
      let c: Classification;
      if (v.old_multiplier_bits === null) {
        c = { kind: 'unclassified', reasons: ['The multiplier before this change was never observed on chain'] };
      } else if (actions.length === 0) {
        c = { kind: 'unclassified', reasons: [`No issuer corporate actions are loaded for ${symbol}`] };
      } else {
        c = classifyTransition(
          {
            mint,
            symbol,
            before: float64FromBits(v.old_multiplier_bits),
            after: float64FromBits(v.new_multiplier_bits),
            activatedAt: new Date(Number(v.scheduled_unix) * 1000),
          },
          actions,
        );
      }
      const next = matchColumns(c);
      if (v.match_id !== null && sameInterpretation(storedMatchFromRow(v), next)) continue;
      // Supersede, never overwrite: the previous interpretation stays as evidence of what was believed and when.
      if (v.match_id !== null) await client.query('UPDATE action_matches SET superseded_at = now() WHERE id = $1', [v.match_id]);
      const { rows: inserted } = await client.query(
        `INSERT INTO action_matches (multiplier_version_id, classifier_version, classification, issuer, external_id, revision,
                                     net_cash_per_share, split_factor_num, split_factor_den, reasons, warnings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          v.id,
          CLASSIFIER_VERSION,
          next.classification,
          next.external_id === null ? null : 'xstocks',
          next.external_id,
          next.revision,
          next.net_cash_per_share,
          next.split_factor_num,
          next.split_factor_den,
          JSON.stringify(next.reasons),
          JSON.stringify(next.warnings),
        ],
      );
      if (v.match_id !== null) {
        await client.query('UPDATE action_matches SET superseded_by = $2 WHERE id = $1', [v.match_id, inserted[0].id]);
        superseded++;
      } else {
        added++;
      }
    }
    if (added + superseded === 0) return;
    const owners = await client.query('SELECT DISTINCT owner FROM position_epochs WHERE mint = $1', [mint]);
    for (const { owner } of owners.rows) {
      await enqueueJob(client, { kind: 'rebuild_positions', businessKey: `rebuild_positions:${owner}`, payload: { owner } });
    }
  });
  ctx.log('info', 'transitions classified', { mint, symbol, added, superseded, unchanged: versions.length - added - superseded });
  return added + superseded;
}

/** One-shot import of issuer corporate actions through the configured source. Never scheduled. */
export async function importIssuerActions(ctx: Context): Promise<{ inserted: number; unchanged: number; rejected: number }> {
  let inserted = 0;
  let unchanged = 0;
  let rejectedCount = 0;
  for (const kind of ['history', 'upcoming'] as const) {
    const { actions, rejected } = await ctx.issuer.corporateActions(kind);
    rejectedCount += rejected.length;
    for (const r of rejected) ctx.log('warn', 'issuer record rejected', { kind, issues: r.issues });
    await withTransaction(ctx.db, async (client) => {
      for (const a of actions) {
        const payload = { ...a, effectiveAt: a.effectiveAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString() };
        const { rowCount } = await client.query(
          `INSERT INTO corporate_actions (issuer, external_id, revision, symbol, kind, status, effective_at, issuer_created_at,
                                          multiplier_old, multiplier_new, gross_cash_per_share, net_cash_per_share, withholding_rate,
                                          from_units, to_units, notes, source, payload, evidence_sha256)
           VALUES ('xstocks', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
           ON CONFLICT (issuer, external_id, revision) DO NOTHING`,
          [
            a.eventId, a.version, a.symbol, a.type, a.status, a.effectiveAt, a.createdAt, a.multiplierOld, a.multiplierNew,
            a.grossCashUsdPerShare, a.netCashUsdPerShare, a.withholdingTaxRate, a.fromUnits, a.toUnits, a.notes,
            ctx.issuer.kind, JSON.stringify(payload), sha256Hex(JSON.stringify(payload)),
          ],
        );
        if (rowCount) inserted++;
        else unchanged++;
      }
      if (kind === 'history') {
        const mints = await client.query('SELECT DISTINCT mint FROM multiplier_versions');
        for (const { mint } of mints.rows) {
          await enqueueJob(client, { kind: 'classify_transitions', businessKey: `classify_transitions:${mint}`, payload: { mint } });
        }
      }
    });
  }
  ctx.log('info', 'issuer actions imported', { inserted, unchanged, rejected: rejectedCount, source: ctx.issuer.kind });
  return { inserted, unchanged, rejected: rejectedCount };
}
