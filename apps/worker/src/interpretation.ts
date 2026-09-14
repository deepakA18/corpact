import { Rational, type Classification } from '@corpact/domain';

/** An action match as stored: the columns that define what a transition was judged to be. */
export interface StoredMatch {
  classification: 'dividend' | 'split' | 'unclassified';
  external_id: string | null;
  revision: number | null;
  net_cash_per_share: string | null;
  split_factor_num: string | null;
  split_factor_den: string | null;
  reasons: string[];
  warnings: string[];
}

export function matchColumns(c: Classification): StoredMatch {
  return {
    classification: c.kind,
    external_id: c.kind === 'unclassified' ? null : c.eventId,
    revision: c.kind === 'unclassified' ? null : c.version,
    net_cash_per_share: c.kind === 'dividend' && c.netCashUsdPerShare ? c.netCashUsdPerShare.toTerminatingDecimal() : null,
    split_factor_num: c.kind === 'split' ? c.factor.num.toString() : null,
    split_factor_den: c.kind === 'split' ? c.factor.den.toString() : null,
    reasons: c.kind === 'unclassified' ? c.reasons : [],
    warnings: c.kind === 'unclassified' ? [] : c.warnings,
  };
}

export function storedMatchFromRow(r: Record<string, unknown>): StoredMatch {
  return {
    classification: r.classification as StoredMatch['classification'],
    external_id: (r.external_id as string | null) ?? null,
    revision: (r.revision as number | null) ?? null,
    net_cash_per_share: (r.net_cash_per_share as string | null) ?? null,
    split_factor_num: (r.split_factor_num as string | null) ?? null,
    split_factor_den: (r.split_factor_den as string | null) ?? null,
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
    stored.external_id === next.external_id &&
    stored.revision === next.revision &&
    sameDecimal(stored.net_cash_per_share, next.net_cash_per_share) &&
    sameRatio(stored.split_factor_num, stored.split_factor_den, next.split_factor_num, next.split_factor_den) &&
    sameStrings(stored.reasons, next.reasons) &&
    sameStrings(stored.warnings, next.warnings)
  );
}
