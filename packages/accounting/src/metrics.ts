import { Rational } from '@corpact/domain';

/** Holdings from `unix` until the next sample, in displayed units at that instant. */
export interface QuantitySample {
  unix: bigint;
  quantity: Rational;
}

export interface DividendPoint {
  unix: bigint;
  quantity: Rational;
  /** Null means unknown - never counted as zero. */
  usd: Rational | null;
}

export interface SplitPoint {
  unix: bigint;
  factor: Rational;
}

export interface DistributionPoint {
  unix: bigint;
  /** Issuer net cash per underlying share at the event; null when the issuer published none. */
  netCashPerShare: Rational | null;
}

export interface Window {
  start: bigint;
  end: bigint;
}

/** Why a yield figure is withheld. Observed quantities are still reported; only the claim is. */
export type YieldExclusion =
  | { code: 'position_incomplete'; message: string }
  | { code: 'coverage_after_window_start'; message: string }
  | { code: 'no_holdings'; message: string }
  | { code: 'missing_net_cash'; message: string };

const byUnix = <T extends { unix: bigint }>(a: T, b: T) => (a.unix < b.unix ? -1 : a.unix > b.unix ? 1 : 0);
const isoOf = (unix: bigint) => new Date(Number(unix) * 1000).toISOString();

/** Converts a quantity observed at `unix` into the latest split basis (every later split applies). */
export function splitBasisAfter(splits: readonly SplitPoint[], unix: bigint): Rational {
  return splits.filter((s) => s.unix > unix).reduce((factor, s) => factor.mul(s.factor), Rational.ONE);
}

export interface WindowMetrics {
  window: Window;
  /** True when ledger coverage begins after the window starts; observed figures then cover only the tracked part. */
  partial: boolean;
  coveredStart: bigint;
  incomeUsd: Rational;
  valuedDividends: number;
  unvaluedDividends: number;
  /** Dividend-attributed shares gained in the covered part of the window, current split basis. */
  dividendQuantity: Rational;
  /** Time-weighted average shares held over the covered part, current split basis; null with no covered time. */
  averageQuantity: Rational | null;
  /** dividendQuantity ÷ averageQuantity. Not annualized. Null whenever `excluded` is set. */
  shareYield: Rational | null;
  excluded: YieldExclusion | null;
}

/**
 * Income and share yield over a window, from the position's quantity timeline (PLAN §7).
 * Needs no price: dividends arrive as reinvested shares, so shares gained over shares held
 * approximates net dividend yield at the prices the issuer reinvested at.
 *
 * A yield is claimed only over a window the ledger fully covers for a completely replayed
 * position (release checklist: partial history is excluded from yield claims).
 */
export function windowMetrics(input: {
  samples: readonly QuantitySample[];
  dividends: readonly DividendPoint[];
  splits: readonly SplitPoint[];
  coverageStart: bigint | null;
  /** False for partial or unsupported positions (gaps, unreplayable start). */
  positionComplete: boolean;
  window: Window;
}): WindowMetrics {
  const { window } = input;
  if (window.end <= window.start) throw new RangeError('Window end must be after its start');
  const partial = input.coverageStart === null || input.coverageStart > window.start;
  const coveredStart =
    input.coverageStart === null ? window.end : input.coverageStart > window.start ? input.coverageStart : window.start;
  const normalized = (s: QuantitySample) => s.quantity.mul(splitBasisAfter(input.splits, s.unix));

  let integral = Rational.ZERO;
  if (coveredStart < window.end) {
    const samples = [...input.samples].sort(byUnix);
    let i = 0;
    let quantity = Rational.ZERO;
    for (; i < samples.length && samples[i]!.unix <= coveredStart; i++) quantity = normalized(samples[i]!);
    let t = coveredStart;
    for (; i < samples.length && samples[i]!.unix < window.end; i++) {
      const s = samples[i]!;
      integral = integral.add(quantity.mul(Rational.of(s.unix - t)));
      t = s.unix;
      quantity = normalized(s);
    }
    integral = integral.add(quantity.mul(Rational.of(window.end - t)));
  }
  const coveredSeconds = window.end - coveredStart;
  const averageQuantity = coveredSeconds > 0n ? integral.div(Rational.of(coveredSeconds)) : null;

  let dividendQuantity = Rational.ZERO;
  let incomeUsd = Rational.ZERO;
  let valuedDividends = 0;
  let unvaluedDividends = 0;
  for (const d of input.dividends) {
    if (d.unix <= coveredStart || d.unix > window.end) continue;
    dividendQuantity = dividendQuantity.add(d.quantity.mul(splitBasisAfter(input.splits, d.unix)));
    if (d.usd === null) unvaluedDividends++;
    else {
      valuedDividends++;
      incomeUsd = incomeUsd.add(d.usd);
    }
  }

  const excluded: YieldExclusion | null = !input.positionComplete
    ? { code: 'position_incomplete', message: 'The position has gaps or an unreplayable start, so no yield is claimed for it' }
    : partial
      ? {
          code: 'coverage_after_window_start',
          message:
            input.coverageStart === null
              ? 'The position has no ledger coverage'
              : `Coverage begins ${isoOf(input.coverageStart)}, after this window starts; yield is claimed only over fully covered windows`,
        }
      : !averageQuantity || averageQuantity.isZero()
        ? { code: 'no_holdings', message: 'Nothing was held during this window' }
        : null;

  return {
    window,
    partial,
    coveredStart,
    incomeUsd,
    valuedDividends,
    unvaluedDividends,
    dividendQuantity,
    averageQuantity,
    shareYield: excluded === null ? dividendQuantity.div(averageQuantity!) : null,
    excluded,
  };
}

export interface TrailingDistribution {
  /** Net cash per current share over the window; null whenever `excluded` is set. */
  perShare: Rational | null;
  distributions: number;
  missingNetCash: number;
  /** True when the observed multiplier history does not reach back to the window start. */
  partial: boolean;
  excluded: YieldExclusion | null;
}

/**
 * Sum of issuer-verified net distributions per share, normalized to today's split basis
 * (PLAN §7). Missing net cash, or history that starts inside the window (distributions
 * before it may be unobserved), withholds the figure.
 */
export function trailingDistributionPerShare(input: {
  distributions: readonly DistributionPoint[];
  splits: readonly SplitPoint[];
  /** Earliest instant the mint's multiplier is known from observed writes; null when unknown. */
  knownFrom: bigint | null;
  window: Window;
}): TrailingDistribution {
  const { window } = input;
  const inWindow = input.distributions.filter((d) => d.unix > window.start && d.unix <= window.end);
  const missingNetCash = inWindow.filter((d) => d.netCashPerShare === null).length;
  const partial = input.knownFrom === null || input.knownFrom > window.start;
  const excluded: YieldExclusion | null = partial
    ? {
        code: 'coverage_after_window_start',
        message:
          input.knownFrom === null
            ? 'The multiplier history of this asset is unknown'
            : `Multiplier history is known from ${isoOf(input.knownFrom)}, after this window starts; earlier distributions may be unobserved`,
      }
    : missingNetCash > 0
      ? { code: 'missing_net_cash', message: `${missingNetCash} distribution(s) in the window have no issuer-reported net cash` }
      : null;
  const perShare =
    excluded !== null
      ? null
      : inWindow.reduce(
          // A later forward split spreads the same cash across more current shares.
          (sum, d) => sum.add(d.netCashPerShare!.div(splitBasisAfter(input.splits, d.unix))),
          Rational.ZERO,
        );
  return { perShare, distributions: inWindow.length, missingNetCash, partial, excluded };
}
