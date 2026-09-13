import { describe, expect, it } from 'vitest';
import { Rational } from './rational';

describe('Rational', () => {
  it('lifts f64 exactly, without a decimal round trip', () => {
    // 0.1 is not 1/10 in binary; the ledger must see the stored value.
    expect(Rational.fromFloat64(0.1).toString()).toBe('3602879701896397/36028797018963968');
    expect(Rational.fromFloat64(10).toString()).toBe('10');
    expect(Rational.fromFloat64(-0.5).toString()).toBe('-1/2');
    expect(Rational.fromFloat64(Number.MIN_VALUE).den).toBe(1n << 1074n);
    expect(Rational.fromFloat64(1.005714560286254).toNumber()).toBe(1.005714560286254);
  });

  it('rejects non-finite floats', () => {
    expect(() => Rational.fromFloat64(Number.NaN)).toThrow(RangeError);
    expect(() => Rational.fromFloat64(Infinity)).toThrow(RangeError);
  });

  it('parses issuer decimal strings exactly, including digits beyond f64 precision', () => {
    expect(Rational.fromDecimal('1.3324612').toString()).toBe('3331153/2500000');
    expect(Rational.fromDecimal('1.002560758222989779').den).toBe(10n ** 18n);
    expect(() => Rational.fromDecimal('1e-3')).toThrow(SyntaxError);
    expect(() => Rational.fromDecimal(' 1')).toThrow(SyntaxError);
  });

  it('floors and ceils toward the correct side for negatives', () => {
    expect(Rational.of(7n, 2n).floor()).toBe(3n);
    expect(Rational.of(7n, 2n).ceil()).toBe(4n);
    expect(Rational.of(-7n, 2n).floor()).toBe(-4n);
    expect(Rational.of(-7n, 2n).ceil()).toBe(-3n);
    expect(Rational.of(6n, 2n).ceil()).toBe(3n);
  });

  it('renders exact terminating decimals for f64 and decimal products, and refuses the rest', () => {
    expect(Rational.fromFloat64(0.1).toTerminatingDecimal()).toBe('0.1000000000000000055511151231257827021181583404541015625');
    expect(Rational.fromDecimal('-1.3324612').mul(Rational.fromFloat64(0.5)).toTerminatingDecimal()).toBe('-0.6662306');
    expect(Rational.of(42n).toTerminatingDecimal()).toBe('42');
    expect(() => Rational.of(1n, 3n).toTerminatingDecimal()).toThrow(RangeError);
  });

  it('formats with half-away-from-zero rounding', () => {
    expect(Rational.of(1n, 8n).toFixed(2)).toBe('0.13');
    expect(Rational.of(-1n, 8n).toFixed(2)).toBe('-0.13');
    expect(Rational.of(1n, 3n).toFixed(0)).toBe('0');
    expect(Rational.of(-1n, 1000n).toFixed(2)).toBe('0.00');
  });
});
