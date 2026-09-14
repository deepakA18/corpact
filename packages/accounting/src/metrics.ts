import { Rational } from '@corpact/domain';

/** Holdings from `unix` until the next sample, in displayed units at that instant. */
export interface QuantitySample {
  unix: bigint;
  quantity: Rational;
}

export interface DividendPoint {
  unix: bigint;
  quantity: Rational;
  /** Null means unknown — never counted as zero. */
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

const byUnix = <T extends { unix: bigint }>(a: T, b: T) => (a.unix < b.unix ? -1 : a.unix > b.unix ? 1 : 0);

/** Converts a quantity observed at `unix` into the latest split basis (every later split applies). */
export function splitBasisAfter(splits: readonly SplitPoint[], unix: bigint): Rational {
  return splits.filter((s) => s.unix > unix).reduce((factor, s) => factor.mul(s.factor), Rational.ONE);
}

export interface WindowMetrics {
  window: Window;
  /** True when ledger coverage begins after the window starts; metrics then cover only the tracked part. */
  partial: boolean;
  coveredStart: bigint;
  incomeUsd: Rational;
  valuedDividends: number;
  unvaluedDividends: number;
  /** Dividend-attributed shares gained in the covered part of the window, current split basis. */
  dividendQuantity: Rational;
  /** Time-weighted average shares held over the covered part, current split basis; null with no covered time. */
  averageQuantity: Rational | null;
  /** dividendQuantity ÷ averageQuantity. Not annualized. Null when nothing was held. */
  shareYield: Rational | null;
}

/**
 * Income and share yield over a window, from the position's quantity timeline (PLAN §7).
 * Needs no price: dividends arrive as reinvested shares, so shares gained over shares held
 * approximates net dividend yield at the prices the issuer reinvested at.
 */
export function windowMetrics(input: {
  samples: readonly QuantitySample[];
  dividends: readonly DividendPoint[];
  splits: readonly SplitPoint[];
  coverageStart: bigint | null;
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

  return {
    window,
    partial,
    coveredStart,
    incomeUsd,
    valuedDividends,
    unvaluedDividends,
    dividendQuantity,
    averageQuantity,
    shareYield: averageQuantity && !averageQuantity.isZero() ? dividendQuantity.div(averageQuantity) : null,
  };
}

export interface TrailingDistribution {
  /** Net cash per current share over the window; null when any distribution lacks issuer net cash. */
  perShare: Rational | null;
  distributions: number;
  missingNetCash: number;
  /** True when the chain history does not reach back to the window start. */
  partial: boolean;
}

/**
 * Sum of issuer-verified net distributions per share, normalized to today's split basis
 * (PLAN §7). Unknown withholding or missing net cash makes the net figure unavailable.
 */
export function trailingDistributionPerShare(input: {
  distributions: readonly DistributionPoint[];
  splits: readonly SplitPoint[];
  knownFrom: bigint | null;
  window: Window;
}): TrailingDistribution {
  const { window } = input;
  const inWindow = input.distributions.filter((d) => d.unix > window.start && d.unix <= window.end);
  const missingNetCash = inWindow.filter((d) => d.netCashPerShare === null).length;
  const perShare =
    missingNetCash > 0
      ? null
      : inWindow.reduce(
          // A later forward split spreads the same cash across more current shares.
          (sum, d) => sum.add(d.netCashPerShare!.div(splitBasisAfter(input.splits, d.unix))),
          Rational.ZERO,
        );
  return {
    perShare,
    distributions: inWindow.length,
    missingNetCash,
    partial: input.knownFrom === null || input.knownFrom > window.start,
  };
}
