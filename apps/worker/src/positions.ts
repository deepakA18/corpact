import { LedgerInvariantError, applyEvent, openPosition, type LedgerEvent, type PositionState } from '@corpact/accounting';
import { withTransaction, type DbClient } from '@corpact/db';
import { Rational, displayedQuantity, type Classification } from '@corpact/domain';
import { TOKEN_2022_PROGRAM, bitsFromFloat64, float64FromBits, type TokenAccountSnapshot } from '@corpact/solana';
import { isoOf, type Context } from './context';
import { crossCheckBalances } from './crosscheck';
import { classificationFromStored, legacyActionKind, storedMatchFromRow } from './interpretation';
import { journalValuesFromEntry, planJournal, recordedQuantity, type JournalValues, type OpenRecognition } from './journal';
import { resolveTransactionOrder } from './transactions';

export const LEDGER_VERSION = 'ledger-v1';
const CONVERSION_NOT_ENABLED = 'Conversion is not enabled in this release';

interface Movement {
  signature: string;
  slot: bigint;
  blockTime: bigint;
  account: string;
  ownerBefore: string | null;
  ownerAfter: string | null;
  rawBefore: bigint;
  rawAfter: bigint;
}

interface VersionRow {
  id: string;
  effectiveUnix: bigint;
  immediate: boolean;
  status: string;
  oldBits: string | null;
  newBits: string;
  matchId: string | null;
  classification: Classification | null;
}

interface EntryLink {
  versionId: string;
  matchId: string | null;
  effectiveUnix: bigint;
  issuerEventId: string | null;
  issuerRevision: number | null;
}

interface PositionResult {
  mint: string;
  symbol: string;
  status: 'complete' | 'partial' | 'unsupported';
  coverageStartUnix: bigint | null;
  coverageStartSlot: bigint | null;
  coverageEndUnix: bigint;
  coverageEndSlot: bigint;
  gaps: string[];
  state: PositionState;
  replayComplete: boolean;
  links: Map<number, EntryLink>;
  checks: Array<{ account: string | null; chainRaw: bigint; ledgerRaw: bigint; matched: boolean }>;
  disabledReasons: string[];
  /** Holdings over time (displayed units at each instant), for time-weighted yield. */
  samples: Array<{ unix: bigint; quantity: Rational }>;
}

function classificationFromRow(r: Record<string, any>): Classification | null {
  if (r.match_id === null) return null;
  return classificationFromStored(storedMatchFromRow(r));
}

async function buildPosition(
  ctx: Context,
  owner: string,
  mint: string,
  asset: { symbol: string; decimals: number },
  snapshot: { slot: bigint; accounts: TokenAccountSnapshot[] },
  clock: { slot: bigint; unixTime: bigint },
  walletGaps: string[],
  providerReasons: readonly string[],
): Promise<PositionResult> {
  const gaps = [...walletGaps];
  const held = snapshot.accounts.filter((a) => a.mint === mint);
  const inventoryRaw = held.reduce((sum, a) => sum + a.amount, 0n);

  const ambiguous = await ctx.db.query(
    `SELECT m.slot FROM balance_movements m LEFT JOIN transaction_indexes ti ON ti.signature = m.signature
      WHERE m.mint = $1 AND (m.owner_before = $2 OR m.owner_after = $2) AND ti.tx_index IS NULL
      GROUP BY m.slot HAVING count(DISTINCT m.signature) > 1`,
    [mint, owner],
  );
  await resolveTransactionOrder(ctx, ambiguous.rows.map((r) => BigInt(r.slot)));

  const { rows: movementRows } = await ctx.db.query(
    `SELECT m.signature, m.slot, ti.tx_index, m.block_time_unix, m.account, m.owner_before, m.owner_after, m.raw_before, m.raw_after
       FROM balance_movements m LEFT JOIN transaction_indexes ti ON ti.signature = m.signature
      WHERE m.mint = $1 AND (m.owner_before = $2 OR m.owner_after = $2) AND m.slot <= $3
      ORDER BY m.slot, ti.tx_index NULLS LAST, m.signature, m.account`,
    [mint, owner, snapshot.slot.toString()],
  );
  const movements: Movement[] = movementRows.map((r) => ({
    signature: r.signature,
    slot: BigInt(r.slot),
    blockTime: BigInt(r.block_time_unix),
    account: r.account,
    ownerBefore: r.owner_before,
    ownerAfter: r.owner_after,
    rawBefore: BigInt(r.raw_before),
    rawAfter: BigInt(r.raw_after),
  }));

  // Per-signature change in the owner's total, with account-level continuity checks.
  let openingRaw = 0n;
  const lastByAccount = new Map<string, Movement>();
  const steps: Array<{ signature: string; slot: bigint; blockTime: bigint; delta: bigint }> = [];
  for (const m of movements) {
    const previous = lastByAccount.get(m.account);
    if (!previous) {
      if (m.ownerBefore === owner) openingRaw += m.rawBefore;
    } else if (previous.rawAfter !== m.rawBefore) {
      gaps.push(`History gap on account ${m.account} between ${previous.signature} and ${m.signature}`);
    }
    lastByAccount.set(m.account, m);
    const delta = (m.ownerAfter === owner ? m.rawAfter : 0n) - (m.ownerBefore === owner ? m.rawBefore : 0n);
    const step = steps.at(-1);
    if (step?.signature === m.signature) step.delta += delta;
    else steps.push({ signature: m.signature, slot: m.slot, blockTime: m.blockTime, delta });
  }

  const cursor = await ctx.db.query('SELECT state, gaps FROM sync_cursors WHERE stream = $1', [`multiplier-timeline:${mint}`]);
  gaps.push(...((cursor.rows[0]?.gaps as string[] | undefined) ?? []));
  const knownFrom = cursor.rows[0]?.state?.knownFrom as { unixTime: string; multiplierBits: string } | null | undefined;

  const { rows: versionRows } = await ctx.db.query(
    `SELECT v.id, v.effective_unix, v.immediate, v.status, v.old_multiplier_bits, v.new_multiplier_bits,
            m.id AS match_id, m.classification, m.action_kind, m.classifier_status, m.external_id, m.revision, m.net_cash_per_share,
            m.split_factor_num, m.split_factor_den, m.distributed_fraction_num, m.distributed_fraction_den, m.proceeds_per_share,
            m.retention_rate, m.refund_note, m.from_underlying, m.to_underlying, m.reasons, m.warnings
       FROM multiplier_versions v
       LEFT JOIN action_matches m ON m.multiplier_version_id = v.id AND m.superseded_at IS NULL
      WHERE v.mint = $1 AND v.status IN ('active', 'orphaned') AND v.effective_unix <= $2
      ORDER BY v.effective_unix, v.id`,
    [mint, clock.unixTime.toString()],
  );
  const versions: VersionRow[] = versionRows.map((r) => ({
    id: String(r.id),
    effectiveUnix: BigInt(r.effective_unix),
    immediate: r.immediate,
    status: r.status,
    oldBits: r.old_multiplier_bits,
    newBits: r.new_multiplier_bits,
    matchId: r.match_id === null ? null : String(r.match_id),
    classification: classificationFromRow(r),
  }));

  const disabledReasons = [CONVERSION_NOT_ENABLED, ...providerReasons];
  const base = { mint, symbol: asset.symbol, coverageEndUnix: clock.unixTime, coverageEndSlot: snapshot.slot, links: new Map<number, EntryLink>() };

  if (!knownFrom) {
    gaps.push('The multiplier history for this mint has not been reconstructed from chain data');
    const latest = versions.at(-1)?.newBits;
    return {
      ...base,
      status: 'unsupported',
      coverageStartUnix: null,
      coverageStartSlot: null,
      gaps,
      state: { ...openPosition(mint, asset.decimals, latest ? float64FromBits(latest) : 1), raw: inventoryRaw },
      replayComplete: false,
      checks: [],
      disabledReasons,
      samples: [],
    };
  }

  let status: PositionResult['status'] = 'complete';
  const known = BigInt(knownFrom.unixTime);
  let start = steps[0]?.blockTime ?? clock.unixTime;
  let startSlot: bigint | null = steps[0]?.slot ?? null;
  let opening = openingRaw;

  if (movements.length === 0) {
    opening = inventoryRaw;
    if (inventoryRaw > 0n) {
      status = 'partial';
      gaps.push('No transaction history was retrieved for this position; it is tracked from now');
    }
  } else if (openingRaw > 0n) {
    status = 'partial';
    gaps.push(`A balance existed before the earliest retrieved transaction (${isoOf(start)}); earlier income is not attributed`);
  }
  if (known > start) {
    status = 'partial';
    gaps.push(`The multiplier is known only from ${isoOf(known)}; income before then is not attributed`);
    for (const s of steps) if (s.blockTime < known) opening += s.delta;
    start = known;
    startSlot = null;
  }
  if (opening < 0n) {
    status = 'partial';
    gaps.push(`Reconstructed opening balance is negative (${opening}); history is incomplete`);
    opening = 0n;
  }

  const activeBits = versions.filter((v) => v.effectiveUnix <= start).at(-1)?.newBits ?? knownFrom.multiplierBits;
  let state = openPosition(mint, asset.decimals, float64FromBits(activeBits));
  if (opening > 0n) state = applyEvent(state, { type: 'deposit', at: new Date(Number(start) * 1000), raw: opening });
  const samples: PositionResult['samples'] = [];
  const sample = (unix: bigint) =>
    samples.push({ unix, quantity: displayedQuantity(state.raw, asset.decimals, Rational.fromFloat64(state.multiplier)) });
  sample(start);

  const links = new Map<number, EntryLink>();
  const pendingSteps = steps.filter((s) => s.blockTime >= start && s.delta !== 0n);
  const pendingVersions = versions.filter((v) => v.effectiveUnix > start);
  let replayComplete = true;
  let si = 0;
  let vi = 0;

  try {
    while (si < pendingSteps.length || vi < pendingVersions.length) {
      const step = pendingSteps[si];
      const version = pendingVersions[vi];
      // A movement at or after activation settles against the new multiplier.
      if (version && (!step || version.effectiveUnix <= step.blockTime)) {
        vi++;
        if (step && version.immediate && version.effectiveUnix === step.blockTime) {
          status = 'partial';
          gaps.push(`Ambiguous boundary: a movement shares the publication second of an immediate multiplier change at ${isoOf(version.effectiveUnix)}`);
        }
        if (version.oldBits === null) {
          throw new LedgerInvariantError(`The multiplier change at ${isoOf(version.effectiveUnix)} starts from an unobserved value`);
        }
        const classification: Classification = version.classification ?? {
          kind: 'unclassified',
          action: 'unknown',
          classifier: 'not_built',
          eventId: null,
          version: null,
          reasons: ['Classification pending'],
        };
        const before = state.entries.length;
        const event: LedgerEvent = {
          type: 'transition',
          transition: {
            mint,
            symbol: asset.symbol,
            before: float64FromBits(version.oldBits),
            after: float64FromBits(version.newBits),
            activatedAt: new Date(Number(version.effectiveUnix) * 1000),
          },
          classification,
        };
        state = applyEvent(state, event);
        sample(version.effectiveUnix);
        if (state.entries.length > before) {
          links.set(state.entries.length - 1, {
            versionId: version.id,
            matchId: version.matchId,
            effectiveUnix: version.effectiveUnix,
            issuerEventId: classification.kind === 'unclassified' ? null : classification.eventId,
            issuerRevision: classification.kind === 'unclassified' ? null : classification.version,
          });
        }
      } else if (step) {
        si++;
        const at = new Date(Number(step.blockTime) * 1000);
        state = applyEvent(state, step.delta > 0n ? { type: 'deposit', at, raw: step.delta } : { type: 'withdrawal', at, raw: -step.delta });
        sample(step.blockTime);
      }
    }
  } catch (err) {
    if (!(err instanceof LedgerInvariantError)) throw err;
    status = 'partial';
    replayComplete = false;
    gaps.push(`Replay stopped: ${err.message}`);
  }

  const checks: PositionResult['checks'] = [];
  if (replayComplete) {
    checks.push({ account: null, chainRaw: inventoryRaw, ledgerRaw: state.raw, matched: inventoryRaw === state.raw });
    for (const [account, last] of lastByAccount) {
      const chainRaw = held.find((a) => a.address === account)?.amount ?? 0n;
      const ledgerRaw = last.ownerAfter === owner ? last.rawAfter : 0n;
      if (chainRaw !== ledgerRaw) checks.push({ account, chainRaw, ledgerRaw, matched: false });
    }
    for (const a of held) {
      if (!lastByAccount.has(a.address) && movements.length > 0) {
        checks.push({ account: a.address, chainRaw: a.amount, ledgerRaw: 0n, matched: a.amount === 0n });
      }
    }
  }
  const reconciled = replayComplete && checks.every((c) => c.matched);
  if (!replayComplete) disabledReasons.push('Replay did not complete');
  for (const c of checks.filter((x) => !x.matched)) {
    disabledReasons.push(`Reconciliation mismatch${c.account ? ` on ${c.account}` : ''} at slot ${snapshot.slot}: chain ${c.chainRaw}, ledger ${c.ledgerRaw}`);
  }
  if (!reconciled) status = 'partial';
  // Any unresolved wallet or multiplier-history gap means coverage is not complete, whatever else checked out.
  if (gaps.length > 0) status = 'partial';

  return {
    ...base,
    status,
    coverageStartUnix: start,
    coverageStartSlot: startSlot,
    gaps,
    state,
    replayComplete,
    links,
    checks,
    disabledReasons,
    samples,
  };
}

/** Conversion stays disabled this long after an issuer correction changes a position's income. */
const CORRECTION_REVIEW_DAYS = 7;

async function openRecognitions(client: DbClient, owner: string, mint: string): Promise<OpenRecognition[]> {
  const { rows } = await client.query(
    `SELECT j.* FROM ledger_journal j
      WHERE j.owner = $1 AND j.mint = $2 AND j.entry_type = 'recognition'
        AND NOT EXISTS (SELECT 1 FROM ledger_journal x WHERE x.reverses_id = j.id)`,
    [owner, mint],
  );
  return rows.map((r) => ({
    id: String(r.id),
    multiplierVersionId: String(r.multiplier_version_id),
    kind: r.kind,
    action: r.action_kind ?? legacyActionKind(r.kind, r.split_factor_num, r.split_factor_den),
    effectiveUnix: BigInt(r.effective_unix),
    quantity: Rational.of(BigInt(r.quantity_num), BigInt(r.quantity_den)),
    splitFactor: r.split_factor_num === null ? null : Rational.of(BigInt(r.split_factor_num), BigInt(r.split_factor_den)),
    usd: r.usd === null ? null : Rational.fromDecimal(r.usd),
    valuation: r.valuation,
    distributedFraction:
      r.distributed_fraction_num === null ? null : Rational.of(BigInt(r.distributed_fraction_num), BigInt(r.distributed_fraction_den)),
    proceedsUsd: r.proceeds_usd === null ? null : Rational.fromDecimal(r.proceeds_usd),
    actionMatchId: r.action_match_id === null ? null : String(r.action_match_id),
    issuerEventId: r.issuer_event_id,
    issuerRevision: r.issuer_revision,
  }));
}

/** Append the reversals and recognitions that bring the journal in line with this replay. Returns rows written. */
async function appendJournal(client: DbClient, owner: string, r: PositionResult): Promise<number> {
  const desired: JournalValues[] = [];
  for (const [index, entry] of r.state.entries.entries()) {
    const link = r.links.get(index);
    if (!link) continue;
    const values = journalValuesFromEntry(entry, {
      multiplierVersionId: link.versionId,
      actionMatchId: link.matchId,
      issuerEventId: link.issuerEventId,
      issuerRevision: link.issuerRevision,
      effectiveUnix: link.effectiveUnix,
    });
    if (values) desired.push(values);
  }
  const plan = planJournal(await openRecognitions(client, owner, r.mint), desired);
  for (const step of plan) {
    const v = step.type === 'reversal' ? step.reverses : step.values;
    await client.query(
      `INSERT INTO ledger_journal (owner, mint, multiplier_version_id, entry_type, kind, effective_unix, quantity_num, quantity_den,
                                   split_factor_num, split_factor_den, usd, valuation, action_match_id, issuer_event_id,
                                   issuer_revision, reverses_id, change_reason, change_detail, action_kind,
                                   distributed_fraction_num, distributed_fraction_den, proceeds_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
      [
        owner, r.mint, v.multiplierVersionId, step.type, v.kind, v.effectiveUnix.toString(),
        v.quantity.num.toString(), v.quantity.den.toString(),
        v.splitFactor?.num.toString() ?? null, v.splitFactor?.den.toString() ?? null,
        v.usd ? v.usd.toTerminatingDecimal() : null, v.valuation, v.actionMatchId, v.issuerEventId, v.issuerRevision,
        step.type === 'reversal' ? step.reverses.id : null, step.reason, step.detail, v.action,
        v.distributedFraction?.num.toString() ?? null, v.distributedFraction?.den.toString() ?? null,
        v.proceedsUsd ? v.proceedsUsd.toTerminatingDecimal() : null,
      ],
    );
  }
  return plan.length;
}

async function journalRevisions(client: DbClient, owner: string, mint: string) {
  const { rows } = await client.query(
    `SELECT multiplier_version_id, count(*)::int AS recognitions,
            max(recorded_at) FILTER (WHERE change_reason <> 'initial') AS last_corrected_at
       FROM ledger_journal
      WHERE owner = $1 AND mint = $2 AND entry_type = 'recognition'
      GROUP BY multiplier_version_id`,
    [owner, mint],
  );
  return new Map(rows.map((r) => [String(r.multiplier_version_id), { revision: r.recognitions as number, lastCorrectedAt: r.last_corrected_at as Date | null }]));
}

/** Rebuild every position for an owner from stored observations and replace them atomically. */
export async function rebuildPositions(ctx: Context, owner: string) {
  const clock = await ctx.chain.finalizedClock();
  const snapshot = await ctx.chain.tokenAccountsByOwner(owner, TOKEN_2022_PROGRAM);
  const { rows: assetRows } = await ctx.db.query(
    `SELECT mint, symbol, decimals FROM assets WHERE verification_error IS NULL AND decimals IS NOT NULL`,
  );
  const assets = new Map(assetRows.map((r) => [r.mint as string, { symbol: r.symbol as string, decimals: Number(r.decimals) }]));
  const { rows: movedRows } = await ctx.db.query(
    'SELECT DISTINCT mint FROM balance_movements WHERE owner_before = $1 OR owner_after = $1',
    [owner],
  );
  const mints = new Set([
    ...snapshot.accounts.filter((a) => a.amount > 0n).map((a) => a.mint as string),
    ...movedRows.map((r) => r.mint as string),
  ]);
  const { rows: syncRows } = await ctx.db.query('SELECT gaps FROM wallet_syncs WHERE owner = $1', [owner]);
  const walletGaps = (syncRows[0]?.gaps as string[] | undefined) ?? [];

  // PLAN Appendix B: pause conversion on source disagreement; keep reads available.
  const providerReasons = new Map<string, string[]>();
  const addReason = (mint: string, reason: string) => providerReasons.set(mint, [...(providerReasons.get(mint) ?? []), reason]);
  const balanceCheck = await crossCheckBalances(ctx, owner, snapshot, new Set(assets.keys()));
  if (balanceCheck?.outcome === 'disagree') {
    for (const d of balanceCheck.differences) {
      addReason(d.mint, `An independent RPC provider reports ${d.secondaryRaw ?? 'no account'} raw on ${d.account}, the primary ${d.primaryRaw ?? 'no account'}; conversion is paused until they agree`);
    }
  }
  const { rows: mintChecks } = await ctx.db.query(
    `SELECT DISTINCT ON (subject) subject, outcome FROM provider_checks WHERE kind = 'mint_state' ORDER BY subject, id DESC`,
  );
  for (const r of mintChecks) {
    if (r.outcome === 'disagree') addReason(r.subject, 'RPC providers disagree on this mint’s multiplier state; conversion is paused until they agree');
  }

  const results: PositionResult[] = [];
  for (const mint of mints) {
    const asset = assets.get(mint);
    if (!asset) continue; // not a verified supported asset
    results.push(await buildPosition(ctx, owner, mint, asset, snapshot, clock, walletGaps, providerReasons.get(mint) ?? []));
  }

  await withTransaction(ctx.db, async (client) => {
    await client.query('DELETE FROM position_epochs WHERE owner = $1', [owner]);
    for (const r of results) {
      // Journal first. Only a complete replay may change recognized income, so a transient gap cannot reverse it.
      const journalChanges = r.replayComplete ? await appendJournal(client, owner, r) : 0;
      if (journalChanges > 0) ctx.log('info', 'ledger journal updated', { owner, mint: r.mint, rows: journalChanges });
      const revisions = await journalRevisions(client, owner, r.mint);
      const disabledReasons = [...r.disabledReasons];
      const correction = await client.query(
        `SELECT max(recorded_at) AS at FROM ledger_journal
          WHERE owner = $1 AND mint = $2 AND change_reason = 'issuer_correction' AND recorded_at > now() - make_interval(days => $3)`,
        [owner, r.mint, CORRECTION_REVIEW_DAYS],
      );
      const correctedAt = correction.rows[0]?.at as Date | null | undefined;
      if (correctedAt) {
        disabledReasons.push(`The issuer corrected a past action on ${correctedAt.toISOString().slice(0, 10)}; review the revised income before converting`);
      }
      const { rows } = await client.query(
        `INSERT INTO position_epochs (owner, mint, epoch, status, coverage_start_unix, coverage_start_slot, coverage_end_unix,
                                      coverage_end_slot, gaps, raw_balance, decimals, multiplier_bits, floor_num, floor_den,
                                      conversion_disabled_reasons, replay_complete, reconciled, ledger_version)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
        [
          owner, r.mint, r.status, r.coverageStartUnix?.toString() ?? null, r.coverageStartSlot?.toString() ?? null,
          r.coverageEndUnix.toString(), r.coverageEndSlot.toString(), JSON.stringify([...new Set(r.gaps)]), r.state.raw.toString(),
          r.state.decimals, bitsFromFloat64(r.state.multiplier), r.state.floor.num.toString(), r.state.floor.den.toString(),
          JSON.stringify(disabledReasons), r.replayComplete, r.checks.length > 0 && r.checks.every((c) => c.matched), LEDGER_VERSION,
        ],
      );
      const epochId = rows[0].id;
      let seq = 0;
      for (const [index, entry] of r.state.entries.entries()) {
        const link = r.links.get(index);
        if (!link || entry.type === 'deposit' || entry.type === 'withdrawal') continue;
        const quantity = recordedQuantity(entry);
        const factor = entry.type === 'split' || entry.type === 'identity_change' ? entry.factor : null;
        await client.query(
          `INSERT INTO income_entries (position_epoch_id, seq, kind, multiplier_version_id, action_match_id, effective_unix,
                                       quantity_num, quantity_den, split_factor_num, split_factor_den, usd, valuation, warnings, reasons,
                                       interpretation_revision, last_corrected_at, action_kind,
                                       distributed_fraction_num, distributed_fraction_den, proceeds_usd)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            epochId, seq++, entry.type, link.versionId, link.matchId, link.effectiveUnix.toString(),
            quantity.num.toString(), quantity.den.toString(),
            factor?.num.toString() ?? null,
            factor?.den.toString() ?? null,
            entry.type === 'dividend' && entry.usd ? entry.usd.toTerminatingDecimal() : null,
            entry.type === 'dividend' ? entry.valuation : null,
            JSON.stringify(entry.type === 'dividend' || entry.type === 'distribution' ? entry.warnings : []),
            JSON.stringify(entry.type === 'unclassified_adjustment' ? entry.reasons : []),
            revisions.get(link.versionId)?.revision ?? 1,
            revisions.get(link.versionId)?.lastCorrectedAt ?? null,
            entry.action,
            entry.type === 'distribution' ? entry.distributedFraction.num.toString() : null,
            entry.type === 'distribution' ? entry.distributedFraction.den.toString() : null,
            entry.type === 'distribution' && entry.proceedsUsd ? entry.proceedsUsd.toTerminatingDecimal() : null,
          ],
        );
      }
      if (r.samples.length > 0) {
        await client.query(
          `INSERT INTO position_quantity_samples (position_epoch_id, seq, effective_unix, quantity_num, quantity_den)
           SELECT $1, * FROM unnest($2::int[], $3::bigint[], $4::numeric[], $5::numeric[])`,
          [
            epochId,
            r.samples.map((_, i) => i),
            r.samples.map((s) => s.unix.toString()),
            r.samples.map((s) => s.quantity.num.toString()),
            r.samples.map((s) => s.quantity.den.toString()),
          ],
        );
      }
      for (const c of r.checks) {
        await client.query(
          `INSERT INTO reconciliation_checks (owner, mint, account, slot, chain_raw, ledger_raw, matched) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [owner, r.mint, c.account, snapshot.slot.toString(), c.chainRaw.toString(), c.ledgerRaw.toString(), c.matched],
        );
      }
    }
  });

  const summary = results.map((r) => ({ symbol: r.symbol, status: r.status, entries: r.links.size, reconciled: r.checks.every((c) => c.matched) }));
  ctx.log('info', 'positions rebuilt', { owner, positions: summary });
  return summary;
}
