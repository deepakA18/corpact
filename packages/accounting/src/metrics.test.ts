import { describe, expect, it } from 'vitest';
import { Rational } from '@corpact/domain';
import { splitBasisAfter, trailingDistributionPerShare, windowMetrics } from './metrics';

const DAY = 86_400n;
const d = (text: string) => Rational.fromDecimal(text);
const window = { start: 0n, end: 100n * DAY };

describe('windowMetrics', () => {
  it('divides shares gained by constant holdings', () => {
    const m = windowMetrics({
      samples: [{ unix: 0n, quantity: d('10') }],
      dividends: [
        { unix: 30n * DAY, quantity: d('0.1'), usd: d('20') },
        { unix: 60n * DAY, quantity: d('0.1'), usd: d('21.5') },
      ],
      splits: [],
      coverageStart: 0n,
      window,
    });
    expect(m.averageQuantity?.eq(d('10'))).toBe(true);
    expect(m.shareYield?.eq(d('0.02'))).toBe(true);
    expect(m.incomeUsd.eq(d('41.5'))).toBe(true);
    expect(m).toMatchObject({ partial: false, valuedDividends: 2, unvaluedDividends: 0 });
  });

  it('time-weights a deposit made half-way through the window', () => {
    const m = windowMetrics({
      samples: [
        { unix: 0n, quantity: d('10') },
        { unix: 50n * DAY, quantity: d('20') },
      ],
      dividends: [],
      splits: [],
      coverageStart: 0n,
      window,
    });
    expect(m.averageQuantity?.eq(d('15'))).toBe(true);
    expect(m.shareYield?.isZero()).toBe(true);
  });

  it('puts everything in the current split basis, so a split changes nothing economically', () => {
    const m = windowMetrics({
      samples: [
        { unix: 0n, quantity: d('10') },
        { unix: 40n * DAY, quantity: d('20') }, // 2-for-1 split applied
      ],
      dividends: [{ unix: 20n * DAY, quantity: d('0.1'), usd: null }],
      splits: [{ unix: 40n * DAY, factor: Rational.of(2n) }],
      coverageStart: 0n,
      window,
    });
    expect(m.averageQuantity?.eq(d('20'))).toBe(true);
    expect(m.dividendQuantity.eq(d('0.2'))).toBe(true);
    expect(m.shareYield?.eq(d('0.01'))).toBe(true);
    expect(m).toMatchObject({ valuedDividends: 0, unvaluedDividends: 1 });
    expect(m.incomeUsd.isZero()).toBe(true);
  });

  it('marks a window partial and measures only the covered part when tracking starts late', () => {
    const m = windowMetrics({
      samples: [{ unix: 50n * DAY, quantity: d('10') }],
      dividends: [
        { unix: 10n * DAY, quantity: d('5'), usd: d('999') }, // before coverage: ignored
        { unix: 75n * DAY, quantity: d('0.1'), usd: d('20') },
      ],
      splits: [],
      coverageStart: 50n * DAY,
      window,
    });
    expect(m.partial).toBe(true);
    expect(m.coveredStart).toBe(50n * DAY);
    expect(m.averageQuantity?.eq(d('10'))).toBe(true);
    expect(m.shareYield?.eq(d('0.01'))).toBe(true);
    expect(m.incomeUsd.eq(d('20'))).toBe(true);
  });

  it('has no average and no yield without coverage or holdings', () => {
    expect(windowMetrics({ samples: [], dividends: [], splits: [], coverageStart: null, window })).toMatchObject({
      partial: true,
      averageQuantity: null,
      shareYield: null,
    });
    expect(windowMetrics({ samples: [{ unix: 0n, quantity: Rational.ZERO }], dividends: [], splits: [], coverageStart: 0n, window }).shareYield).toBeNull();
  });

  it('rejects an empty window', () => {
    expect(() => windowMetrics({ samples: [], dividends: [], splits: [], coverageStart: 0n, window: { start: 5n, end: 5n } })).toThrow(RangeError);
  });
});

describe('trailingDistributionPerShare', () => {
  const year = { start: 0n, end: 365n * DAY };

  it('sums net cash per share, dividing earlier distributions by later splits', () => {
    const t = trailingDistributionPerShare({
      distributions: [
        { unix: 30n * DAY, netCashPerShare: d('1') },
        { unix: 120n * DAY, netCashPerShare: d('1') },
        { unix: 250n * DAY, netCashPerShare: d('0.5') },
      ],
      splits: [{ unix: 200n * DAY, factor: Rational.of(2n) }],
      knownFrom: 0n,
      window: year,
    });
    expect(t.perShare?.eq(d('1.5'))).toBe(true); // 0.5 + 0.5 + 0.5
    expect(t).toMatchObject({ distributions: 3, missingNetCash: 0, partial: false });
  });

  it('is unavailable when any distribution lacks issuer net cash, and partial when history is short', () => {
    const t = trailingDistributionPerShare({
      distributions: [
        { unix: 30n * DAY, netCashPerShare: d('1') },
        { unix: 90n * DAY, netCashPerShare: null },
      ],
      splits: [],
      knownFrom: 60n * DAY,
      window: year,
    });
    expect(t).toMatchObject({ perShare: null, distributions: 2, missingNetCash: 1, partial: true });
  });

  it('ignores splits that happened before the quantity was observed', () => {
    expect(splitBasisAfter([{ unix: 10n, factor: Rational.of(3n) }], 10n).eq(Rational.ONE)).toBe(true);
    expect(splitBasisAfter([{ unix: 11n, factor: Rational.of(3n) }], 10n).eq(Rational.of(3n))).toBe(true);
  });
});
