import { describe, expect, it } from 'vitest';
import { Rational } from '@corpact/domain';
import { matchColumns, sameInterpretation } from './interpretation';

const dividend = (revision: number, net: string | null, warnings: string[] = []) =>
  matchColumns({ kind: 'dividend', eventId: 'evt', version: revision, netCashUsdPerShare: net === null ? null : Rational.fromDecimal(net), warnings });

describe('sameInterpretation', () => {
  it('treats numerically equal values as the same, however Postgres formats them', () => {
    expect(sameInterpretation({ ...dividend(1, '0.357'), net_cash_per_share: '0.3570' }, dividend(1, '0.357'))).toBe(true);
    const split = matchColumns({ kind: 'split', eventId: 'evt', version: 1, factor: Rational.of(10n), warnings: [] });
    expect(sameInterpretation({ ...split, split_factor_num: '20', split_factor_den: '2' }, split)).toBe(true);
  });

  it('detects a new issuer revision, a changed amount, and changed evidence text', () => {
    expect(sameInterpretation(dividend(1, '0.357'), dividend(2, '0.357'))).toBe(false);
    expect(sameInterpretation(dividend(1, '0.357'), dividend(1, '0.35'))).toBe(false);
    expect(sameInterpretation(dividend(1, '0.357'), dividend(1, null))).toBe(false);
    expect(sameInterpretation(dividend(1, '0.357'), dividend(1, '0.357', ['new warning']))).toBe(false);
  });

  it('detects a change of kind', () => {
    const unclassified = matchColumns({ kind: 'unclassified', reasons: ['No published issuer action matches the observed multiplier change'] });
    expect(sameInterpretation(unclassified, dividend(8, null))).toBe(false);
  });
});
