import { describe, expect, it } from 'vitest';
import { Rational } from '@corpact/domain';
import { classificationFromStored, legacyActionKind, matchColumns, sameInterpretation, storedMatchFromRow } from './interpretation';

const dividend = (revision: number, net: string | null, warnings: string[] = []) =>
  matchColumns({
    kind: 'dividend',
    action: 'cash_dividend',
    classifier: 'validated',
    eventId: 'evt',
    version: revision,
    netCashUsdPerShare: net === null ? null : Rational.fromDecimal(net),
    retentionRate: null,
    refundNote: null,
    warnings,
  });

describe('sameInterpretation', () => {
  it('treats numerically equal values as the same, however Postgres formats them', () => {
    expect(sameInterpretation({ ...dividend(1, '0.357'), net_cash_per_share: '0.3570' }, dividend(1, '0.357'))).toBe(true);
    const split = matchColumns({ kind: 'split', action: 'forward_split', classifier: 'validated', eventId: 'evt', version: 1, factor: Rational.of(10n), warnings: [] });
    expect(sameInterpretation({ ...split, split_factor_num: '20', split_factor_den: '2' }, split)).toBe(true);
  });

  it('detects a new issuer revision, a changed amount, and changed evidence text', () => {
    expect(sameInterpretation(dividend(1, '0.357'), dividend(2, '0.357'))).toBe(false);
    expect(sameInterpretation(dividend(1, '0.357'), dividend(1, '0.35'))).toBe(false);
    expect(sameInterpretation(dividend(1, '0.357'), dividend(1, null))).toBe(false);
    expect(sameInterpretation(dividend(1, '0.357'), dividend(1, '0.357', ['new warning']))).toBe(false);
  });

  it('detects a change of kind, and a change of the recognised action alone', () => {
    const unmatched = matchColumns({
      kind: 'unclassified',
      action: 'unknown',
      classifier: 'not_built',
      eventId: null,
      version: null,
      reasons: ['No published issuer action matches the observed multiplier change'],
    });
    expect(sameInterpretation(unmatched, dividend(8, null))).toBe(false);
    expect(sameInterpretation(unmatched, { ...unmatched, action_kind: 'spin_off', external_id: 'evt', revision: 2 })).toBe(false);
  });
});

describe('stored rows before the taxonomy', () => {
  it('derive the action kind the old classification implied', () => {
    expect(legacyActionKind('dividend', null, null)).toBe('cash_dividend');
    expect(legacyActionKind('split', '10', '1')).toBe('forward_split');
    expect(legacyActionKind('split', '1', '2')).toBe('reverse_split');
    expect(legacyActionKind('unclassified', null, null)).toBe('unknown');
  });

  it('round-trip through the stored columns to the same classification', () => {
    const legacy = storedMatchFromRow({ classification: 'split', external_id: 'hon', revision: 2, split_factor_num: '1', split_factor_den: '2', reasons: [], warnings: [] });
    expect(legacy).toMatchObject({ action_kind: 'reverse_split', classifier_status: 'validated' });
    const c = classificationFromStored(legacy);
    expect(c).toMatchObject({ kind: 'split', action: 'reverse_split', eventId: 'hon', version: 2 });
    expect(c.kind === 'split' && c.factor.eq(Rational.of(1n, 2n))).toBe(true);
    expect(sameInterpretation(matchColumns(c), legacy)).toBe(true);
  });
});
