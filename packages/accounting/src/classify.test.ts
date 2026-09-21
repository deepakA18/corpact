import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Rational, type ObservedTransition } from '@corpact/domain';
import { parseCorporateActions, type MultiplierHistoryNode } from '@corpact/issuers';
import { classifyTransition, sameF64 } from './classify';

interface Fixture {
  symbol: string;
  mint: string;
  multiplierHistory: MultiplierHistoryNode[];
  corporateActions: unknown[];
}

const load = (symbol: string) => {
  const f = JSON.parse(readFileSync(join(import.meta.dirname, '../../../fixtures/xstocks', `${symbol}.json`), 'utf8')) as Fixture;
  const { actions, rejected } = parseCorporateActions(f.corporateActions);
  expect(rejected).toEqual([]);
  // Issuer multiplier history stands in for chain observations until archival replay exists.
  const transitions: ObservedTransition[] = f.multiplierHistory.map((h) => ({
    mint: f.mint,
    symbol: f.symbol,
    before: h.previousMultiplier,
    after: h.multiplier,
    activatedAt: new Date(h.activationDateTime),
  }));
  const at = (iso: string) => {
    const t = transitions.find((x) => x.activatedAt.toISOString() === iso);
    if (!t) throw new Error(`no ${symbol} transition at ${iso}`);
    return t;
  };
  return { actions, transitions, at };
};

describe('sameF64', () => {
  it('accepts adjacent doubles and rejects anything wider', () => {
    expect(sameF64(1.020191445467247, 1.0201914454672472)).toBe(true);
    expect(sameF64(1.0201914454672472, 1.0201914454672472 + 1e-12)).toBe(false);
  });
});

describe('classifyTransition against recorded issuer data', () => {
  it('SPYx: confirmed cash dividend carries the issuer net cash per share', () => {
    const { actions, at } = load('SPYx');
    const c = classifyTransition(at('2026-06-18T04:00:00.000Z'), actions);
    expect(c.kind).toBe('dividend');
    if (c.kind === 'dividend') {
      expect(c.netCashUsdPerShare?.eq(Rational.fromDecimal('1.3324612'))).toBe(true);
      expect(c.warnings).toEqual([]);
    }
  });

  it('SPYx: a dividend with no published net or withholding stays a dividend with unknown USD', () => {
    const { actions, at } = load('SPYx');
    const c = classifyTransition(at('2026-05-01T00:15:00.000Z'), actions);
    expect(c.kind).toBe('dividend');
    if (c.kind === 'dividend') {
      expect(c.netCashUsdPerShare).toBeNull();
      expect(c.warnings.join()).toMatch(/no net cash/);
    }
  });

  it('HONx: matches across the one-ULP disagreement between issuer endpoints', () => {
    const { actions, at } = load('HONx');
    expect(classifyTransition(at('2026-05-15T00:30:00.000Z'), actions).kind).toBe('dividend');
  });

  it('HONx: reverse split reconciles to factor 1/2', () => {
    const { actions, at } = load('HONx');
    const c = classifyTransition(at('2026-06-29T15:30:00.000Z'), actions);
    expect(c.kind).toBe('split');
    if (c.kind === 'split') expect(c.factor.eq(Rational.of(1n, 2n))).toBe(true);
  });

  it('HONx: the spin-off (multiplier 0.51 → 0.999) is never booked as dividend income', () => {
    const { actions, at } = load('HONx');
    const c = classifyTransition(at('2026-06-29T23:55:00.000Z'), actions);
    expect(c.kind).not.toBe('dividend');
    expect(c).toMatchObject({ kind: 'distribution', action: 'spin_off', eventId: expect.stringMatching(/^ca3da1bc/) });
  });

  it('KLACx: 10-for-1 split on top of a dividend-carrying multiplier', () => {
    const { actions, at } = load('KLACx');
    const c = classifyTransition(at('2026-06-12T13:30:00.000Z'), actions);
    expect(c.kind).toBe('split');
    if (c.kind === 'split') expect(c.factor.eq(Rational.of(10n))).toBe(true);
  });

  it('refuses to classify when no issuer action matches, whatever the size of the change', () => {
    const { actions, transitions } = load('SPYx');
    const t = transitions[0]!;
    const c = classifyTransition({ ...t, after: t.after + 1e-6 }, actions);
    expect(c.kind).toBe('unclassified');
  });

  it('refuses to classify when the activation time disagrees with the issuer', () => {
    const { actions, at } = load('SPYx');
    const t = at('2026-06-18T04:00:00.000Z');
    const c = classifyTransition({ ...t, activatedAt: new Date(t.activatedAt.getTime() + 60_000) }, actions);
    expect(c.kind).toBe('unclassified');
  });

  it('STRCx: uses the latest correction, never a cancelled or superseded version', () => {
    const { actions, at } = load('STRCx');
    // Event c5721924 has v2 Initial, v3/v5/v7 Cancelled, v4/v6/v8 Corrected - only v8 is current.
    expect(classifyTransition(at('2026-08-30T23:55:00.000Z'), actions)).toMatchObject({
      kind: 'dividend',
      eventId: 'c5721924-4b13-4c29-81db-cf075a49ba2d',
      version: 8,
    });
  });

  it('STRCx: a multiplier change the issuer never published an action for stays unclassified', () => {
    const { actions, at } = load('STRCx');
    for (const iso of ['2026-04-01T00:30:00.000Z', '2026-05-15T00:30:00.000Z']) {
      expect(classifyTransition(at(iso), actions)).toMatchObject({
        kind: 'unclassified',
        reasons: [expect.stringMatching(/No published issuer action/)],
      });
    }
  });

  it('HONx: a spin-off the multiplier-history endpoint labels "Dividend" is a basis allocation, never income', () => {
    const { actions, at } = load('HONx');
    expect(classifyTransition(at('2025-10-30T23:55:00.000Z'), actions)).toMatchObject({
      kind: 'distribution',
      action: 'spin_off',
      warnings: [expect.stringMatching(/no proceeds amount/)],
    });
  });

  it('carries the claimed action kind and validation status on every outcome', () => {
    const { actions, at } = load('STRCx');
    expect(classifyTransition(at('2026-04-01T00:30:00.000Z'), actions)).toMatchObject({ kind: 'unclassified', action: 'unknown', classifier: 'not_built' });
    expect(classifyTransition(at('2026-08-30T23:55:00.000Z'), actions)).toMatchObject({ action: 'cash_dividend', classifier: 'validated' });
  });
});
