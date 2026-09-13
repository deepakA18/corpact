import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Rational, scaledUsdPrice, type Classification, type ObservedTransition } from '@corpact/domain';
import { LedgerInvariantError, applyEvent, openPosition, positionView, replay, type PositionState } from './ledger';

const MINT = 'XsTestMint1111111111111111111111111111111111';
const DECIMALS = 8;
const at = new Date('2026-01-01T00:00:00Z');

const tx = (before: number, after: number): ObservedTransition => ({
  mint: MINT,
  symbol: 'TESTx',
  before,
  after,
  activatedAt: at,
});
const dividend = (net: string | null): Classification => ({
  kind: 'dividend',
  eventId: 'div',
  version: 1,
  netCashUsdPerShare: net === null ? null : Rational.fromDecimal(net),
  warnings: [],
});
const split = (factor: Rational): Classification => ({ kind: 'split', eventId: 'split', version: 1, factor, warnings: [] });
const unclassified: Classification = { kind: 'unclassified', reasons: ['test'] };
const q = (text: string) => Rational.fromDecimal(text);

describe('ledger — worked example (dyadic multipliers so every value is exact)', () => {
  let s = openPosition(MINT, DECIMALS, 1);

  it('deposit sets the protected floor to the deposited quantity', () => {
    s = applyEvent(s, { type: 'deposit', at, raw: 1_000_000_000n }); // 10 tokens
    const v = positionView(s);
    expect(v.quantity.eq(q('10'))).toBe(true);
    expect(v.floor.eq(q('10'))).toBe(true);
    expect(v.availableQuantity.isZero()).toBe(true);
    expect(v.maximumHarvestRaw).toBe(0n);
  });

  it('a verified dividend adds income without moving the floor, valued from issuer net cash', () => {
    s = applyEvent(s, { type: 'transition', transition: tx(1, 1.125), classification: dividend('2') });
    const v = positionView(s);
    expect(v.quantity.eq(q('11.25'))).toBe(true);
    expect(v.floor.eq(q('10'))).toBe(true);
    expect(v.availableQuantity.eq(q('1.25'))).toBe(true);
    expect(v.dividendIncomeUsd.eq(q('20'))).toBe(true); // 10 shares × $2 net
    // ceil(10 × 1e8 / 1.125) = 888,888,889 — rounding keeps principal.
    expect(v.protectedRaw).toBe(888_888_889n);
    expect(v.maximumHarvestRaw).toBe(111_111_111n);
    expect(Rational.of(v.maximumHarvestRaw, 10n ** 8n).mul(q('1.125')).compare(v.availableQuantity)).toBeLessThanOrEqual(0);
  });

  it('a split scales the floor and books no income', () => {
    s = applyEvent(s, { type: 'transition', transition: tx(1.125, 2.25), classification: split(q('2')) });
    const v = positionView(s);
    expect(v.floor.eq(q('20'))).toBe(true);
    expect(v.availableQuantity.eq(q('2.5'))).toBe(true);
    expect(v.dividendIncomeUsd.eq(q('20'))).toBe(true);
  });

  it('retained dividend exposure earns the next dividend; market price is the labelled fallback', () => {
    s = applyEvent(s, {
      type: 'transition',
      transition: tx(2.25, 2.5),
      classification: dividend(null),
      marketPriceScaled: scaledUsdPrice(q('50')),
    });
    const v = positionView(s);
    expect(v.availableQuantity.eq(q('5'))).toBe(true);
    expect(v.dividendIncomeUsd.eq(q('145'))).toBe(true);
    const last = s.entries.at(-1);
    expect(last?.type === 'dividend' && last.valuation).toBe('market_estimate');
  });

  it('an external sale removes principal and unharvested income proportionally, keeping historical income', () => {
    s = applyEvent(s, { type: 'withdrawal', at, raw: 500_000_000n });
    const v = positionView(s);
    expect(v.floor.eq(q('10'))).toBe(true);
    expect(v.availableQuantity.eq(q('2.5'))).toBe(true);
    expect(v.dividendIncomeUsd.eq(q('145'))).toBe(true);
  });

  it('an unclassified increase makes nothing newly available and books no income', () => {
    const before = positionView(s);
    s = applyEvent(s, { type: 'transition', transition: tx(2.5, 3), classification: unclassified });
    const v = positionView(s);
    expect(v.availableQuantity.eq(before.availableQuantity.mul(q('1.2')))).toBe(true);
    expect(v.dividendIncomeUsd.eq(before.dividendIncomeUsd)).toBe(true);
    expect(s.entries.at(-1)?.type).toBe('unclassified_adjustment');
  });

  it('refuses a transition that does not start where the position is — a missed activation is loud', () => {
    expect(() =>
      applyEvent(s, { type: 'transition', transition: tx(2.5, 2.75), classification: dividend('1') }),
    ).toThrow(LedgerInvariantError);
  });

  it('records no income for a transition while the position is empty, but tracks the multiplier', () => {
    const empty = applyEvent(openPosition(MINT, DECIMALS, 1), {
      type: 'transition',
      transition: tx(1, 1.5),
      classification: dividend('3'),
    });
    expect(empty.entries).toHaveLength(0);
    expect(empty.multiplier).toBe(1.5);
  });

  it('unvalued dividends are counted, not treated as zero', () => {
    const p = replay(openPosition(MINT, DECIMALS, 1), [
      { type: 'deposit', at, raw: 100_000_000n },
      { type: 'transition', transition: tx(1, 1.25), classification: dividend(null) },
    ]);
    const v = positionView(p);
    expect(v.unvaluedDividends).toBe(1);
    expect(v.dividendIncomeUsd.isZero()).toBe(true);
  });

  it('distrusts issuer cash that does not reconcile with the shares delivered, falling back to market', () => {
    const p = replay(openPosition(MINT, DECIMALS, 1), [
      { type: 'deposit', at, raw: 100_000_000n }, // 1 token
      // Delivered 1/1024 share, yet the issuer reports $1 net per share: implied $1,024/share against $50.
      {
        type: 'transition',
        transition: tx(1, 1 + 1 / 1024),
        classification: dividend('1'),
        marketPriceScaled: scaledUsdPrice(q('50')),
      },
    ]);
    const last = p.entries.at(-1);
    expect(last?.type).toBe('dividend');
    if (last?.type === 'dividend') {
      expect(last.valuation).toBe('market_estimate');
      expect(last.usd?.eq(Rational.of(50n, 1024n))).toBe(true);
      expect(last.warnings.join()).toMatch(/implies reinvestment at \$1024\.00/);
    }
  });
});

type Op =
  | { k: 'deposit'; raw: bigint }
  | { k: 'withdraw'; permille: number }
  | { k: 'dividend'; bump: number }
  | { k: 'split'; factor: number }
  | { k: 'unclassified'; bump: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ k: fc.constant('deposit' as const), raw: fc.bigInt({ min: 1n, max: 10n ** 14n }) }),
  fc.record({ k: fc.constant('withdraw' as const), permille: fc.integer({ min: 1, max: 1000 }) }),
  fc.record({ k: fc.constant('dividend' as const), bump: fc.double({ min: 1e-7, max: 0.05, noNaN: true }) }),
  fc.record({ k: fc.constant('split' as const), factor: fc.constantFrom(2, 3, 4, 10, 0.5, 0.2) }),
  fc.record({ k: fc.constant('unclassified' as const), bump: fc.double({ min: -0.5, max: 1, noNaN: true }) }),
);

function step(s: PositionState, op: Op): PositionState {
  switch (op.k) {
    case 'deposit':
      return applyEvent(s, { type: 'deposit', at, raw: op.raw });
    case 'withdraw': {
      const raw = (s.raw * BigInt(op.permille)) / 1000n;
      return raw > 0n ? applyEvent(s, { type: 'withdrawal', at, raw }) : s;
    }
    case 'dividend': {
      const after = s.multiplier * (1 + op.bump);
      if (!(after > s.multiplier)) return s;
      return applyEvent(s, { type: 'transition', transition: tx(s.multiplier, after), classification: dividend('0.5') });
    }
    case 'split': {
      const after = s.multiplier * op.factor;
      const factor = Rational.fromFloat64(after).div(Rational.fromFloat64(s.multiplier));
      return applyEvent(s, { type: 'transition', transition: tx(s.multiplier, after), classification: split(factor) });
    }
    case 'unclassified': {
      const after = s.multiplier * (1 + op.bump);
      if (!(after > 0) || after === s.multiplier) return s;
      return applyEvent(s, { type: 'transition', transition: tx(s.multiplier, after), classification: unclassified });
    }
  }
}

describe('ledger — properties', () => {
  it('never lets the floor exceed the position, and a harvest never touches principal', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        let s = openPosition(MINT, DECIMALS, 1);
        for (const op of ops) {
          s = step(s, op);
          const v = positionView(s);
          expect(v.quantity.compare(v.floor)).toBeGreaterThanOrEqual(0);
          const harvestQuantity = Rational.of(v.maximumHarvestRaw, 10n ** BigInt(DECIMALS)).mul(Rational.fromFloat64(s.multiplier));
          expect(harvestQuantity.compare(v.availableQuantity)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it('dividends never move the floor; splits and unclassified changes never add income', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        let s = openPosition(MINT, DECIMALS, 1);
        for (const op of ops) {
          const before = positionView(s);
          s = step(s, op);
          const after = positionView(s);
          if (op.k === 'dividend') expect(after.floor.eq(before.floor)).toBe(true);
          if (op.k === 'split' || op.k === 'unclassified') {
            expect(after.dividendIncomeUsd.eq(before.dividendIncomeUsd)).toBe(true);
          }
          if (op.k === 'unclassified' && before.availableQuantity.isZero()) {
            expect(after.availableQuantity.isZero()).toBe(true);
          }
          expect(after.dividendIncomeUsd.compare(before.dividendIncomeUsd)).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });
});
