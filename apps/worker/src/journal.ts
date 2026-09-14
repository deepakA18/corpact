import type { LedgerEntry } from '@corpact/accounting';
import { Rational } from '@corpact/domain';

export type AdjustmentKind = 'dividend' | 'split' | 'unclassified_adjustment';
export type ChangeReason = 'initial' | 'issuer_correction' | 'balance_history_changed' | 'valuation_changed' | 'no_longer_applicable';

/** What the ledger recognized for one multiplier transition of one position. */
export interface JournalValues {
  multiplierVersionId: string;
  kind: AdjustmentKind;
  effectiveUnix: bigint;
  quantity: Rational;
  splitFactor: Rational | null;
  /** Null means unknown, never zero. */
  usd: Rational | null;
  valuation: 'issuer_net_cash' | 'market_estimate' | null;
  actionMatchId: string | null;
  issuerEventId: string | null;
  issuerRevision: number | null;
}

/** A recognition in the journal that no reversal has cancelled yet. */
export interface OpenRecognition extends JournalValues {
  id: string;
}

export type JournalAppend =
  | { type: 'recognition'; values: JournalValues; reason: ChangeReason; detail: string | null }
  | { type: 'reversal'; reverses: OpenRecognition; reason: ChangeReason; detail: string | null };

export function journalValuesFromEntry(
  entry: LedgerEntry,
  link: { multiplierVersionId: string; actionMatchId: string | null; issuerEventId: string | null; issuerRevision: number | null; effectiveUnix: bigint },
): JournalValues | null {
  const base = { ...link };
  switch (entry.type) {
    case 'dividend':
      return { ...base, kind: 'dividend', quantity: entry.quantity, splitFactor: null, usd: entry.usd, valuation: entry.valuation };
    case 'split':
      return { ...base, kind: 'split', quantity: Rational.ZERO, splitFactor: entry.factor, usd: null, valuation: null };
    case 'unclassified_adjustment':
      return { ...base, kind: 'unclassified_adjustment', quantity: entry.quantityDelta, splitFactor: null, usd: null, valuation: null };
    default:
      return null;
  }
}

const eqNullable = (a: Rational | null, b: Rational | null) => (a === null || b === null ? a === b : a.eq(b));

function decimal(r: Rational | null): string {
  if (r === null) return 'unknown';
  try {
    return r.toTerminatingDecimal();
  } catch {
    return r.toFixed(18);
  }
}

const evidenceLabel = (v: JournalValues) =>
  v.kind === 'unclassified_adjustment' ? 'unclassified adjustment' : `${v.kind} per issuer action ${v.issuerEventId} revision ${v.issuerRevision}`;

/** Why a recognition differs from what the ledger now produces, or null when it does not. */
export function describeChange(before: JournalValues, after: JournalValues): { reason: ChangeReason; detail: string } | null {
  const sameEvidence = before.kind === after.kind && before.issuerEventId === after.issuerEventId && before.issuerRevision === after.issuerRevision;
  const sameQuantity =
    before.quantity.eq(after.quantity) && eqNullable(before.splitFactor, after.splitFactor) && before.effectiveUnix === after.effectiveUnix;
  const sameValue = eqNullable(before.usd, after.usd) && before.valuation === after.valuation;
  if (sameEvidence && sameQuantity && sameValue) return null;
  if (!sameEvidence) return { reason: 'issuer_correction', detail: `${evidenceLabel(before)} → ${evidenceLabel(after)}` };
  if (!sameQuantity) {
    return { reason: 'balance_history_changed', detail: `quantity ${decimal(before.quantity)} → ${decimal(after.quantity)}` };
  }
  return { reason: 'valuation_changed', detail: `USD ${decimal(before.usd)} → ${decimal(after.usd)}` };
}

export class JournalInvariantError extends Error {
  override name = 'JournalInvariantError';
}

/**
 * The journal rows that bring recognized income in line with the current replay. Pure.
 * Nothing is edited: a changed recognition is reversed and a replacement appended; a
 * recognition the replay no longer produces is reversed.
 */
export function planJournal(open: readonly OpenRecognition[], desired: readonly JournalValues[]): JournalAppend[] {
  const openByVersion = new Map<string, OpenRecognition>();
  for (const o of open) {
    if (openByVersion.has(o.multiplierVersionId)) {
      throw new JournalInvariantError(`Two unreversed recognitions for multiplier version ${o.multiplierVersionId}`);
    }
    openByVersion.set(o.multiplierVersionId, o);
  }

  const appends: JournalAppend[] = [];
  const produced = new Set<string>();
  for (const d of desired) {
    produced.add(d.multiplierVersionId);
    const current = openByVersion.get(d.multiplierVersionId);
    if (!current) {
      appends.push({ type: 'recognition', values: d, reason: 'initial', detail: null });
      continue;
    }
    const change = describeChange(current, d);
    if (!change) continue;
    appends.push({ type: 'reversal', reverses: current, ...change }, { type: 'recognition', values: d, ...change });
  }
  for (const o of open) {
    if (!produced.has(o.multiplierVersionId)) {
      appends.push({ type: 'reversal', reverses: o, reason: 'no_longer_applicable', detail: 'The ledger replay no longer produces this entry' });
    }
  }
  return appends;
}
