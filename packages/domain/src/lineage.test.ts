import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LineageError, reinvestedDistributionFraction, reinvestedSpinOffLink, traceLineage, validateLink, type InstrumentRef, type LineageLink } from './lineage';
import { Rational } from './rational';

const inst = (symbol: string, underlyingSymbol = symbol.replace(/x$/, ''), mint = `mint-${symbol}`): InstrumentRef => ({ mint, symbol, underlyingSymbol, underlyingIsin: null });
const at = (day: number) => new Date(Date.UTC(2026, 0, day));

describe('reinvested spin-off allocation (recorded xStocks spin-offs)', () => {
  it('HONx 2026-06-29: 48.75% of the position’s value came from the distribution', () => {
    const f = reinvestedDistributionFraction(0.5120473566533945, 0.9990655067370947);
    expect(f.toFixed(5)).toBe('0.48747');
  });

  it('keeps (1 − f) × M_new equal to M_old exactly, for any increasing multiplier (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 50, noNaN: true }), fc.double({ min: 1.000001, max: 3, noNaN: true }), (before, growth) => {
        const after = before * growth;
        fc.pre(after > before && Number.isFinite(after));
        const f = reinvestedDistributionFraction(before, after);
        expect(f.compare(Rational.ZERO) > 0 && f.compare(Rational.ONE) < 0).toBe(true);
        expect(Rational.ONE.sub(f).mul(Rational.fromFloat64(after)).eq(Rational.fromFloat64(before))).toBe(true);
      }),
    );
  });

  it('refuses a non-increasing multiplier', () => {
    expect(() => reinvestedDistributionFraction(1, 1)).toThrow(LineageError);
    expect(() => reinvestedDistributionFraction(1, 0.5)).toThrow(LineageError);
  });
});

describe('validateLink', () => {
  it('conserves basis exactly on a reinvested spin-off link', () => {
    const link = reinvestedSpinOffLink({ at: at(1), issuerEventId: 'ca3da1bc', parent: inst('HONx'), multiplierBefore: 0.5120473566533945, multiplierAfter: 0.9990655067370947 });
    const total = link.to.reduce((s, x) => s.add(x.basisFraction), link.cashBasisFraction);
    expect(total.eq(Rational.ONE)).toBe(true);
  });

  it('rejects links that lose or invent basis, or misuse their kind', () => {
    const half = Rational.of(1n, 2n);
    const bad: LineageLink[] = [
      { kind: 'identity_change', at: at(1), issuerEventId: null, from: inst('AZNx'), to: [{ instrument: inst('AZNx', 'AZN.L'), basisFraction: half, quantityFactor: null }], cashBasisFraction: Rational.ZERO },
      { kind: 'terminate', at: at(1), issuerEventId: null, from: inst('Xx'), to: [], cashBasisFraction: half },
      { kind: 'transform', at: at(1), issuerEventId: null, from: inst('Ax'), to: [{ instrument: inst('Ax'), basisFraction: Rational.ONE, quantityFactor: null }], cashBasisFraction: Rational.ZERO },
      { kind: 'spin_off', at: at(1), issuerEventId: null, from: inst('Px'), to: [{ instrument: inst('Px'), basisFraction: Rational.ONE, quantityFactor: null }], cashBasisFraction: Rational.ZERO },
    ];
    for (const link of bad) expect(() => validateLink(link)).toThrow(LineageError);
  });
});

describe('traceLineage', () => {
  it('follows an ADR conversion, then a mixed merger, then a termination, conserving basis at every step', () => {
    const adr = inst('AZNx', 'AZN');
    const ordinary = inst('AZNx', 'AZN.L');
    const acquirer = inst('BIGx', 'BIG', 'mint-BIGx');
    const links: LineageLink[] = [
      { kind: 'identity_change', at: at(2), issuerEventId: 'azn', from: adr, to: [{ instrument: ordinary, basisFraction: Rational.ONE, quantityFactor: Rational.of(1n, 2n) }], cashBasisFraction: Rational.ZERO },
      { kind: 'transform', at: at(3), issuerEventId: 'merge', from: ordinary, to: [{ instrument: acquirer, basisFraction: Rational.of(3n, 5n), quantityFactor: Rational.of(3n) }], cashBasisFraction: Rational.of(2n, 5n) },
      { kind: 'terminate', at: at(4), issuerEventId: 'redeem', from: acquirer, to: [], cashBasisFraction: Rational.ONE },
    ];
    const afterMerger = traceLineage(adr, links.slice(0, 2));
    expect(afterMerger.map((h) => [h.instrument.underlyingSymbol, h.basisFraction.toFixed(2)])).toEqual([['BIG', '0.60']]);
    const final = traceLineage(adr, links);
    expect(final).toEqual([expect.objectContaining({ terminated: true })]);
  });

  it('never carries more basis than it started with, whatever the chain of spin-offs (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 1.0001, max: 2, noNaN: true }), { minLength: 1, maxLength: 6 }), (growths) => {
        let m = 1;
        const parent = inst('Px');
        const links = growths.map((g, i) => {
          const before = m;
          m = m * g;
          return reinvestedSpinOffLink({ at: at(i + 1), issuerEventId: `e${i}`, parent, multiplierBefore: before, multiplierAfter: m });
        });
        const [held] = traceLineage(parent, links);
        expect(held!.basisFraction.compare(Rational.ONE) <= 0 && held!.basisFraction.compare(Rational.ZERO) > 0).toBe(true);
        // Basis carried by the parent equals M_first / M_last: every distribution's share left as cash.
        expect(held!.basisFraction.eq(Rational.ONE.div(Rational.fromFloat64(m)).mul(Rational.fromFloat64(1)))).toBe(true);
      }),
    );
  });
});
