import type { Address } from '@solana/kit';
import type { Float64Bits } from './bytes';
import type { ScaledUiAmountConfig } from './mint';

/** PLAN §5.1. `slot` is a bigint here and a string at serialization boundaries. */
export interface ChainCursor {
  slot: bigint;
  /** Position within the block. Null until resolved from getBlock, which ordering within one slot requires. */
  txIndex: number | null;
  instructionPath: number[];
}

export class CursorOrderError extends Error {
  override name = 'CursorOrderError';
}

/** One decoded ScaledUiAmount instruction, exactly as written. */
export interface MultiplierWrite {
  mint: Address;
  signature: string;
  cursor: ChainCursor;
  /** The slot's Clock.unix_timestamp (RPC `blockTime`) — what the program compared the timestamp against. */
  clockUnix: bigint;
  kind: 'initialize' | 'update';
  multiplierBits: Float64Bits;
  /** Effective timestamp as written; `initialize` carries none. */
  effectiveUnix: bigint;
}

export type TransitionStatus = 'scheduled' | 'active' | 'superseded' | 'orphaned';

/** PLAN §5.1 MultiplierTransition, plus the effective boundary this timeline resolved. */
export interface MultiplierTransition {
  mint: Address;
  updateSignature: string;
  observedAt: ChainCursor;
  scheduledUnix: bigint;
  /** When the new value became live: its schedule, or the publication itself when the schedule was already past. */
  effectiveUnix: bigint;
  /** True when the write took effect at publication rather than at a future schedule. */
  immediate: boolean;
  /** Null when the value before this transition was never observed (status `orphaned`, or `scheduled` from an unknown start). */
  oldMultiplierBits: Float64Bits | null;
  newMultiplierBits: Float64Bits;
  status: TransitionStatus;
}

export interface MultiplierTimeline {
  mint: Address;
  transitions: MultiplierTransition[];
  /** The earliest point from which the active multiplier is known exactly. Before it, nothing can be replayed. */
  knownFrom: { unixTime: bigint; cursor: ChainCursor; multiplierBits: Float64Bits } | null;
  /** The mint's stored extension fields as the observed writes leave them — compare with live state. */
  stored: { multiplierBits: Float64Bits | null; newMultiplierBits: Float64Bits | null; effectiveUnix: bigint | null };
}

function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

export function compareWrites(a: MultiplierWrite, b: MultiplierWrite): number {
  if (a.cursor.slot !== b.cursor.slot) return a.cursor.slot < b.cursor.slot ? -1 : 1;
  if (a.signature !== b.signature) {
    if (a.cursor.txIndex === null || b.cursor.txIndex === null) {
      throw new CursorOrderError(`Writes ${a.signature} and ${b.signature} share slot ${a.cursor.slot} without a transaction order`);
    }
    return a.cursor.txIndex - b.cursor.txIndex;
  }
  return comparePaths(a.cursor.instructionPath, b.cursor.instructionPath);
}

/**
 * Replays ScaledUiAmount writes through the Token-2022 processor rules
 * (`process_initialize` / `process_update_multiplier`) and reports every change in
 * the *economically active* multiplier. Pure; `nowUnix` is finalized cluster time.
 *
 * Processor rules mirrored:
 * - On update, a pending value whose timestamp has passed is first promoted into `multiplier`.
 * - The written value becomes `new_multiplier`; a negative timestamp is stored as 0.
 * - If the written timestamp is not in the future, it is applied to `multiplier` immediately.
 * - A pending value overwritten before its timestamp never becomes live (superseded).
 */
export function buildMultiplierTimeline(
  mint: Address,
  writes: readonly MultiplierWrite[],
  nowUnix: bigint,
): MultiplierTimeline {
  const ordered = writes.filter((w) => w.mint === mint).toSorted(compareWrites);
  let multiplier: Float64Bits | null = null;
  let newMultiplier: Float64Bits | null = null;
  let effective: bigint | null = null;
  let pending: MultiplierWrite | null = null;
  let knownFrom: MultiplierTimeline['knownFrom'] = null;
  const transitions: MultiplierTransition[] = [];

  const activeAt = (clock: bigint): Float64Bits | null =>
    effective !== null && clock >= effective ? newMultiplier : multiplier;

  const scheduled = (p: MultiplierWrite, old: Float64Bits | null, status: TransitionStatus): MultiplierTransition => ({
    mint,
    updateSignature: p.signature,
    observedAt: p.cursor,
    scheduledUnix: p.effectiveUnix,
    effectiveUnix: p.effectiveUnix,
    immediate: false,
    oldMultiplierBits: old,
    newMultiplierBits: p.multiplierBits,
    status,
  });

  const settlePending = (clock: bigint) => {
    if (!pending) return;
    if (clock >= pending.effectiveUnix) {
      if (multiplier !== pending.multiplierBits) {
        transitions.push(scheduled(pending, multiplier, multiplier === null ? 'orphaned' : 'active'));
      }
      knownFrom ??= { unixTime: pending.effectiveUnix, cursor: pending.cursor, multiplierBits: pending.multiplierBits };
    } else {
      transitions.push(scheduled(pending, multiplier, 'superseded'));
    }
    pending = null;
  };

  for (const w of ordered) {
    const clock = w.clockUnix;
    settlePending(clock);
    const before = activeAt(clock);

    if (w.kind === 'initialize') {
      multiplier = w.multiplierBits;
      newMultiplier = w.multiplierBits;
      effective = 0n;
    } else {
      if (effective !== null && clock >= effective) multiplier = newMultiplier;
      newMultiplier = w.multiplierBits;
      effective = w.effectiveUnix < 0n ? 0n : w.effectiveUnix;
      if (clock >= effective) multiplier = w.multiplierBits;
    }

    const after = activeAt(clock);
    if (after !== null) knownFrom ??= { unixTime: clock, cursor: w.cursor, multiplierBits: after };
    if (before !== null && after !== null && before !== after) {
      transitions.push({
        mint,
        updateSignature: w.signature,
        observedAt: w.cursor,
        scheduledUnix: effective,
        effectiveUnix: clock,
        immediate: true,
        oldMultiplierBits: before,
        newMultiplierBits: after,
        status: 'active',
      });
    }
    if (w.kind === 'update' && clock < effective) pending = w;
  }

  if (pending) {
    const p: MultiplierWrite = pending;
    if (nowUnix >= p.effectiveUnix) {
      settlePending(nowUnix);
    } else if (multiplier !== p.multiplierBits) {
      transitions.push(scheduled(p, multiplier, 'scheduled'));
    }
  }

  return { mint, transitions, knownFrom, stored: { multiplierBits: multiplier, newMultiplierBits: newMultiplier, effectiveUnix: effective } };
}

/** Differences between the observed writes and the mint's live extension state. Empty means consistent. */
export function verifyTimelineAgainstMint(timeline: MultiplierTimeline, config: ScaledUiAmountConfig): string[] {
  const { stored } = timeline;
  if (stored.newMultiplierBits === null) return ['No multiplier writes observed for this mint'];
  const reasons: string[] = [];
  if (stored.newMultiplierBits !== config.newMultiplierBits || stored.effectiveUnix !== config.newMultiplierEffectiveTimestamp) {
    reasons.push(
      `Latest observed write schedules ${stored.newMultiplierBits}@${stored.effectiveUnix} but the mint stores ${config.newMultiplierBits}@${config.newMultiplierEffectiveTimestamp}; later writes are missing`,
    );
  }
  if (stored.multiplierBits !== null && stored.multiplierBits !== config.multiplierBits) {
    reasons.push(`Observed writes leave multiplier ${stored.multiplierBits} but the mint stores ${config.multiplierBits}`);
  }
  return reasons;
}
