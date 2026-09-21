/**
 * The Phase 0 findings are the product's value. These tests pin them against the
 * full recorded issuer data set so a refactor cannot quietly undo them.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Rational, type IssuerCorporateAction, type ObservedTransition } from '@corpact/domain';
import { createFixtureXStocksSource, type MultiplierHistoryNode } from '@corpact/issuers';
import { classifyTransition } from './classify';
import { openPosition, positionView, replay, type LedgerEvent } from './ledger';

const source = createFixtureXStocksSource();
let actions: IssuerCorporateAction[];
const mints = new Map<string, string>();

beforeAll(async () => {
  const history = await source.corporateActions('history');
  expect(history.rejected).toEqual([]);
  actions = history.actions;
  for (const a of await source.listSolanaAssets()) mints.set(a.symbol, a.mint);
});

async function transitionsFor(symbol: string): Promise<ObservedTransition[]> {
  const { history, rejected } = await source.multiplierHistory(symbol);
  expect(rejected).toEqual([]);
  return history
    .toSorted((a: MultiplierHistoryNode, b: MultiplierHistoryNode) => a.activationDateTime.localeCompare(b.activationDateTime))
    .map((h) => ({
      mint: mints.get(symbol)!,
      symbol,
      before: h.previousMultiplier,
      after: h.multiplier,
      activatedAt: new Date(h.activationDateTime),
    }));
}

const at = (transitions: ObservedTransition[], iso: string) => {
  const t = transitions.find((x) => x.activatedAt.toISOString() === iso);
  if (!t) throw new Error(`no transition at ${iso}`);
  return t;
};

describe('HONx: a spin-off must never book as income', () => {
  it('replays dividend → reverse split → spin-off → dividend with income only from the two dividends', async () => {
    const all = await transitionsFor('HONx');
    const window = all.filter((t) => t.activatedAt >= new Date('2026-05-15T00:00:00Z'));
    expect(window.map((t) => t.activatedAt.toISOString())).toEqual([
      '2026-05-15T00:30:00.000Z',
      '2026-06-29T15:30:00.000Z',
      '2026-06-29T23:55:00.000Z',
      '2026-08-14T00:30:00.000Z',
    ]);

    const tokens = 10n;
    const events: LedgerEvent[] = [
      { type: 'deposit', at: new Date('2026-05-01T00:00:00Z'), raw: tokens * 100_000_000n },
      ...window.map((transition) => ({
        type: 'transition' as const,
        transition,
        classification: classifyTransition(transition, actions),
      })),
    ];
    const state = replay(openPosition(window[0]!.mint, 8, window[0]!.before), events);

    expect(state.entries.map((e) => e.type)).toEqual(['deposit', 'dividend', 'split', 'distribution', 'dividend']);
    const spinOff = state.entries[3]!;
    expect(spinOff.type === 'distribution' && spinOff.action).toBe('spin_off');

    // Income is exactly shares-held × issuer net cash for the two real dividends - nothing from the +95% spin-off.
    const expected = Rational.of(tokens)
      .mul(Rational.fromFloat64(window[0]!.before))
      .mul(Rational.fromDecimal('0.833'))
      .add(Rational.of(tokens).mul(Rational.fromFloat64(window[3]!.before)).mul(Rational.fromDecimal('0.49')));
    expect(positionView(state).dividendIncomeUsd.eq(expected)).toBe(true);
    expect(positionView(state).dividendIncomeUsd.compare(Rational.of(25n))).toBeLessThan(0);
  });
});

describe('STRCx: an implausible issuer cash figure is not used for valuation', () => {
  it('keeps 2025-11-30 as a dividend but refuses its $953k/share implied valuation', async () => {
    const t = at(await transitionsFor('STRCx'), '2025-11-30T23:55:00.000Z');
    const c = classifyTransition(t, actions);
    expect(c.kind).toBe('dividend');
    if (c.kind !== 'dividend') return;
    expect(c.netCashUsdPerShare).toBeNull();
    expect(c.warnings.join()).toMatch(/implies reinvestment at \$953[\d,.]*\/share against a median/);
  });

  it('leaves the USD value of that event unknown in the ledger - counted, never zero', async () => {
    const t = at(await transitionsFor('STRCx'), '2025-11-30T23:55:00.000Z');
    const state = replay(openPosition(t.mint, 8, t.before), [
      { type: 'deposit', at: new Date('2025-11-01T00:00:00Z'), raw: 100_000_000n },
      { type: 'transition', transition: t, classification: classifyTransition(t, actions) },
    ]);
    expect(positionView(state)).toMatchObject({ unvaluedDividends: 1 });
    expect(positionView(state).dividendIncomeUsd.isZero()).toBe(true);
  });

  it('still values the ordinary STRCx dividends from issuer evidence', async () => {
    const c = classifyTransition(at(await transitionsFor('STRCx'), '2026-03-13T00:15:00.000Z'), actions);
    expect(c).toMatchObject({ kind: 'dividend', warnings: [] });
    expect(c.kind === 'dividend' && c.netCashUsdPerShare?.eq(Rational.fromDecimal('0.67083331'))).toBe(true);
  });
});

describe('unclassified changes carry their reason', () => {
  // Spin-offs, SCCOx, KRAQx and AZNx are classified now: see spinoffs.test.ts and basis-events.test.ts.
  it.each([
    ['STRCx', '2026-04-01T00:30:00.000Z', /No published issuer action/],
    ['JPMx', '2026-04-03T13:00:00.000Z', /No published issuer action/],
  ])('%s %s', async (symbol, iso, reason) => {
    const c = classifyTransition(at(await transitionsFor(symbol), iso), actions);
    expect(c.kind).toBe('unclassified');
    expect(c.kind === 'unclassified' && c.reasons.join()).toMatch(reason);
  });
});

describe('whole recorded universe', () => {
  it('classifies all 654 recorded multiplier changes: 630 dividends, 10 splits, 7 distributions, 1 identity change, 6 unclassified', async () => {
    const tally: Record<string, number> = {};
    const actionTally: Record<string, number> = {};
    for (const symbol of mints.keys()) {
      for (const t of await transitionsFor(symbol)) {
        const c = classifyTransition(t, actions);
        tally[c.kind] = (tally[c.kind] ?? 0) + 1;
        actionTally[c.action] = (actionTally[c.action] ?? 0) + 1;
      }
    }
    expect(tally).toEqual({ dividend: 630, split: 10, distribution: 7, identity_change: 1, unclassified: 6 });
    expect(actionTally).toEqual({
      cash_dividend: 628,
      withholding_adjustment: 2,
      forward_split: 8,
      reverse_split: 1,
      stock_dividend: 1,
      spin_off: 6,
      rights_distribution: 1,
      identity_change: 1,
      unknown: 6,
    });
  });
});
