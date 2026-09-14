import type { LedgerEntry } from '@corpact/accounting';
import { Rational, type ActionKind } from '@corpact/domain';

export type AdjustmentKind = 'dividend' | 'split' | 'distribution' | 'identity_change' | 'unclassified_adjustment';

/**
 * The quantity recorded for an entry. Ordinary splits record zero, as they always have; kinds that API v1 presents
 * as unclassified adjustments (stock dividends, identity changes) record the unit change v1 has always shown for them.
 */
export function recordedQuantity(entry: LedgerEntry): Rational {
  switch (entry.type) {
    case 'dividend':
      return entry.quantity;
    case 'split':
      return entry.action === 'stock_dividend' ? entry.quantityDelta : Rational.ZERO;
    case 'identity_change':
    case 'distribution':
    case 'unclassified_adjustment':
      return entry.quantityDelta;
    default:
      return Rational.ZERO;
  }
}
export type ChangeReason = 'initial' | 'issuer_correction' | 'balance_history_changed' | 'valuation_changed' | 'no_longer_applicable';

/** What the ledger recognized for one multiplier transition of one position. */
export interface JournalValues {
  multiplierVersionId: string;
  kind: AdjustmentKind;
  /** Taxonomy kind; informational, not part of the evidence comparison (kind and issuer revision are). */
  action: ActionKind;
  effectiveUnix: bigint;
  quantity: Rational;
  splitFactor: Rational | null;
  /** Null means unknown, never zero. */
  usd: Rational | null;
  valuation: 'issuer_net_cash' | 'market_estimate' | null;
  /** For a distribution: the share of the position's value it delivered. */
  distributedFraction: Rational | null;
  /** For a distribution: shares held × issuer proceeds per share, when usable. Never income. */
  proceedsUsd: Rational | null;
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
      return { ...base, kind: 'dividend', action: entry.action, quantity: entry.quantity, splitFactor: null, usd: entry.usd, valuation: entry.valuation, distributedFraction: null, proceedsUsd: null };
    case 'split':
      return { ...base, kind: 'split', action: entry.action, quantity: recordedQuantity(entry), splitFactor: entry.factor, usd: null, valuation: null, distributedFraction: null, proceedsUsd: null };
    case 'identity_change':
      return { ...base, kind: 'identity_change', action: entry.action, quantity: recordedQuantity(entry), splitFactor: entry.factor, usd: null, valuation: null, distributedFraction: null, proceedsUsd: null };
    case 'distribution':
      return {
        ...base,
        kind: 'distribution',
        action: entry.action,
        quantity: entry.quantityDelta,
        splitFactor: null,
        usd: null,
        valuation: null,
        distributedFraction: entry.distributedFraction,
        proceedsUsd: entry.proceedsUsd,
      };
    case 'unclassified_adjustment':
      return { ...base, kind: 'unclassified_adjustment', action: entry.action, quantity: entry.quantityDelta, splitFactor: null, usd: null, valuation: null, distributedFraction: null, proceedsUsd: null };
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
    before.quantity.eq(after.quantity) &&
    eqNullable(before.splitFactor, after.splitFactor) &&
    eqNullable(before.distributedFraction, after.distributedFraction) &&
    before.effectiveUnix === after.effectiveUnix;
  const sameValue = eqNullable(before.usd, after.usd) && before.valuation === after.valuation && eqNullable(before.proceedsUsd, after.proceedsUsd);
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
