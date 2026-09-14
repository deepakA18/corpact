import { ACTION_KIND_SPECS, Rational, type ActionKind, type Classification, type ClassifierStatus } from '@corpact/domain';

/** An action match as stored: the columns that define what a transition was judged to be. */
export interface StoredMatch {
  classification: Classification['kind'];
  action_kind: ActionKind;
  classifier_status: ClassifierStatus;
  external_id: string | null;
  revision: number | null;
  net_cash_per_share: string | null;
  split_factor_num: string | null;
  split_factor_den: string | null;
  distributed_fraction_num: string | null;
  distributed_fraction_den: string | null;
  proceeds_per_share: string | null;
  retention_rate: string | null;
  refund_note: string | null;
  from_underlying: string | null;
  to_underlying: string | null;
  reasons: string[];
  warnings: string[];
}

/** A split or an identity change stores its unit factor in the split-factor columns. */
const factorOf = (c: Classification) => (c.kind === 'split' || c.kind === 'identity_change' ? c.factor : null);

export function matchColumns(c: Classification): StoredMatch {
  const factor = factorOf(c);
  return {
    classification: c.kind,
    action_kind: c.action,
    classifier_status: c.classifier,
    // An unclassified change keeps the issuer record it was recognised against, if any.
    external_id: c.eventId,
    revision: c.version,
    net_cash_per_share: c.kind === 'dividend' && c.netCashUsdPerShare ? c.netCashUsdPerShare.toTerminatingDecimal() : null,
    split_factor_num: factor ? factor.num.toString() : null,
    split_factor_den: factor ? factor.den.toString() : null,
    distributed_fraction_num: c.kind === 'distribution' ? c.distributedFraction.num.toString() : null,
    distributed_fraction_den: c.kind === 'distribution' ? c.distributedFraction.den.toString() : null,
    proceeds_per_share: c.kind === 'distribution' && c.proceedsUsdPerShare ? c.proceedsUsdPerShare.toTerminatingDecimal() : null,
    retention_rate: c.kind === 'dividend' && c.retentionRate ? c.retentionRate.toTerminatingDecimal() : null,
    refund_note: c.kind === 'dividend' ? c.refundNote : null,
    from_underlying: c.kind === 'identity_change' ? c.fromUnderlying : null,
    to_underlying: c.kind === 'identity_change' ? c.toUnderlying : null,
    reasons: c.kind === 'unclassified' ? c.reasons : [],
    warnings: c.kind === 'unclassified' ? [] : c.warnings,
  };
}

/** The action kind an old row implies when it was stored before the taxonomy existed. */
export function legacyActionKind(kind: string, splitNum: string | null, splitDen: string | null): ActionKind {
  if (kind === 'dividend') return 'cash_dividend';
  if (kind === 'split') return splitNum !== null && splitDen !== null && BigInt(splitNum) < BigInt(splitDen) ? 'reverse_split' : 'forward_split';
  if (kind === 'distribution') return 'spin_off';
  if (kind === 'identity_change') return 'identity_change';
  return 'unknown';
}

const text = (v: unknown) => (v === null || v === undefined ? null : String(v));

export function storedMatchFromRow(r: Record<string, unknown>): StoredMatch {
  const classification = r.classification as StoredMatch['classification'];
  const split_factor_num = text(r.split_factor_num);
  const split_factor_den = text(r.split_factor_den);
  const action_kind = (r.action_kind as ActionKind | null) ?? legacyActionKind(classification, split_factor_num, split_factor_den);
  return {
    classification,
    action_kind,
    classifier_status: (r.classifier_status as ClassifierStatus | null) ?? ACTION_KIND_SPECS[action_kind].classifier,
    external_id: (r.external_id as string | null) ?? null,
    revision: (r.revision as number | null) ?? null,
    net_cash_per_share: text(r.net_cash_per_share),
    split_factor_num,
    split_factor_den,
    distributed_fraction_num: text(r.distributed_fraction_num),
    distributed_fraction_den: text(r.distributed_fraction_den),
    proceeds_per_share: text(r.proceeds_per_share),
    retention_rate: text(r.retention_rate),
    refund_note: text(r.refund_note),
    from_underlying: text(r.from_underlying),
    to_underlying: text(r.to_underlying),
    reasons: (r.reasons as string[] | null) ?? [],
    warnings: (r.warnings as string[] | null) ?? [],
  };
}

const sameDecimal = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : Rational.fromDecimal(a).eq(Rational.fromDecimal(b));

const sameRatio = (an: string | null, ad: string | null, bn: string | null, bd: string | null) =>
  an === null || ad === null || bn === null || bd === null
    ? an === bn && ad === bd
    : Rational.of(BigInt(an), BigInt(ad)).eq(Rational.of(BigInt(bn), BigInt(bd)));

const sameStrings = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((s, i) => s === b[i]);

/** Equal meaning, regardless of how Postgres formats numerics. Any difference supersedes the stored match. */
export function sameInterpretation(stored: StoredMatch, next: StoredMatch): boolean {
  return (
    stored.classification === next.classification &&
    stored.action_kind === next.action_kind &&
    stored.classifier_status === next.classifier_status &&
    stored.external_id === next.external_id &&
    stored.revision === next.revision &&
    sameDecimal(stored.net_cash_per_share, next.net_cash_per_share) &&
    sameRatio(stored.split_factor_num, stored.split_factor_den, next.split_factor_num, next.split_factor_den) &&
    sameRatio(stored.distributed_fraction_num, stored.distributed_fraction_den, next.distributed_fraction_num, next.distributed_fraction_den) &&
    sameDecimal(stored.proceeds_per_share, next.proceeds_per_share) &&
    sameDecimal(stored.retention_rate, next.retention_rate) &&
    stored.refund_note === next.refund_note &&
    stored.from_underlying === next.from_underlying &&
    stored.to_underlying === next.to_underlying &&
    sameStrings(stored.reasons, next.reasons) &&
    sameStrings(stored.warnings, next.warnings)
  );
}

const storedFactor = (m: StoredMatch) => Rational.of(BigInt(m.split_factor_num!), BigInt(m.split_factor_den!));

/** Rebuild the classification a stored match row describes. */
export function classificationFromStored(m: StoredMatch): Classification {
  const base = { classifier: m.classifier_status, eventId: m.external_id!, version: m.revision!, warnings: m.warnings };
  switch (m.classification) {
    case 'dividend':
      return {
        ...base,
        kind: 'dividend',
        action: m.action_kind === 'withholding_adjustment' ? 'withholding_adjustment' : 'cash_dividend',
        netCashUsdPerShare: m.net_cash_per_share === null ? null : Rational.fromDecimal(m.net_cash_per_share),
        retentionRate: m.retention_rate === null ? null : Rational.fromDecimal(m.retention_rate),
        refundNote: m.refund_note,
      };
    case 'split':
      return {
        ...base,
        kind: 'split',
        action: m.action_kind === 'reverse_split' || m.action_kind === 'unit_split' || m.action_kind === 'stock_dividend' ? m.action_kind : 'forward_split',
        factor: storedFactor(m),
      };
    case 'distribution':
      return {
        ...base,
        kind: 'distribution',
        action: m.action_kind === 'rights_distribution' ? 'rights_distribution' : 'spin_off',
        distributedFraction: Rational.of(BigInt(m.distributed_fraction_num!), BigInt(m.distributed_fraction_den!)),
        proceedsUsdPerShare: m.proceeds_per_share === null ? null : Rational.fromDecimal(m.proceeds_per_share),
      };
    case 'identity_change':
      return { ...base, kind: 'identity_change', action: 'identity_change', factor: storedFactor(m), fromUnderlying: m.from_underlying, toUnderlying: m.to_underlying };
    case 'unclassified':
      return { kind: 'unclassified', action: m.action_kind, classifier: m.classifier_status, eventId: m.external_id, version: m.revision, reasons: m.reasons };
  }
}
