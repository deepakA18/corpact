import type { MultiplierTransition } from '@corpact/solana';

/** A write published within this long after its own schedule is a late publication (VTIx 2026-03-26: 70 s). */
export const LATE_PUBLICATION_TOLERANCE = 3600n;

/**
 * Whether the chain timeline holds the original write for a scheduled activation.
 * A value that only appears as an immediate change long after its schedule came from a
 * later transaction re-asserting it: the original write is still missing, and the change
 * is being placed at the wrong time.
 */
export function hintSatisfied(transitions: readonly MultiplierTransition[], activationUnix: bigint): boolean {
  return transitions.some(
    (t) =>
      t.scheduledUnix === activationUnix &&
      t.status !== 'superseded' &&
      (!t.immediate || t.effectiveUnix - t.scheduledUnix <= LATE_PUBLICATION_TOLERANCE),
  );
}
