/**
 * Spin-offs, validated against every recorded instance (docs/findings/corporate-actions-census.md §2).
 * xStocks sell the distributed shares and reinvest the proceeds into the parent through the multiplier,
 * so a spin-off is a basis allocation on the parent: units added are principal, never income.
 */
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { Rational, type Classification, type IssuerCorporateAction, type ObservedTransition } from '@corpact/domain';
import { createFixtureXStocksSource } from '@corpact/issuers';
import { classifyTransition } from './classify';
import { applyEvent, openPosition, positionView, replay } from './ledger';

const source = createFixtureXStocksSource();
let actions: IssuerCorporateAction[];
const mints = new Map<string, string>();

beforeAll(async () => {
  actions = (await source.corporateActions('history')).actions;
  for (const a of await source.listSolanaAssets()) mints.set(a.symbol, a.mint);
});

async function transition(symbol: string, iso: string): Promise<ObservedTransition> {
  const h = (await source.multiplierHistory(symbol)).history.find((x) => x.activationDateTime === iso);
  if (!h) throw new Error(`no ${symbol} change at ${iso}`);
  return { mint: mints.get(symbol)!, symbol, before: h.previousMultiplier, after: h.multiplier, activatedAt: new Date(iso) };
}

const RECORDED: Array<[string, string, string, string]> = [
  // symbol, activation, multiplier-history label, distributed share of the position (5 dp)
  ['HONx', '2026-06-29T23:55:00.000Z', 'Administrative', '0.48747'],
  ['CMCSAx', '2026-01-07T23:55:00.000Z', 'Administrative', '0.04505'],
  ['OPENx', '2025-11-24T23:55:00.000Z', 'Dividend', '0.02039'],
  ['DFDVx', '2025-11-07T23:55:00.000Z', 'Dividend', '0.01452'],
  ['HONx', '2025-10-30T23:55:00.000Z', 'Dividend', '0.01090'],
  ['GMEx', '2025-10-08T23:55:00.000Z', 'Dividend', '0.00528'],
];

describe('every recorded spin-off is a distribution, whatever its label says', () => {
  it.each(RECORDED)('%s %s (labelled "%s") distributes %s of the position', async (symbol, iso, label, share) => {
    const history = (await source.multiplierHistory(symbol)).history.find((x) => x.activationDateTime === iso);
    expect(history?.reason).toBe(label);
    const c = classifyTransition(await transition(symbol, iso), actions);
    expect(c).toMatchObject({ kind: 'distribution', action: 'spin_off', classifier: 'validated' });
    expect(c.kind === 'distribution' && c.distributedFraction.toFixed(5)).toBe(share);
  });

  it('HONx 2026-06-29 keeps its $216.66 issuer proceeds: they imply a parent price within 3% of its dividends', async () => {
    const c = classifyTransition(await transition('HONx', '2026-06-29T23:55:00.000Z'), actions);
    expect(c.kind === 'distribution' && c.proceedsUsdPerShare?.eq(Rational.fromDecimal('216.6649884'))).toBe(true);
    expect(c.kind === 'distribution' && c.warnings.some((w) => /not used/.test(w))).toBe(false);
  });

  it('CMCSAx carries the issuer note that proves how it was delivered', async () => {
    const c = classifyTransition(await transition('CMCSAx', '2026-01-07T23:55:00.000Z'), actions);
    expect(c.kind === 'distribution' && c.warnings.join(' ')).toMatch(/Sell of 373\.48 shares of VSNT/);
    expect(c.kind === 'distribution' && c.proceedsUsdPerShare).toBeNull();
  });
});

describe('spin-off ledger semantics', () => {
  it('HONx: dividend → reverse split → spin-off → dividend books income only from the two dividends, and the spin-off makes nothing convertible', async () => {
    const window = (await source.multiplierHistory('HONx')).history
      .filter((h) => h.activationDateTime >= '2026-05-15')
      .toSorted((a, b) => a.activationDateTime.localeCompare(b.activationDateTime));
    let state = applyEvent(openPosition(mints.get('HONx')!, 8, window[0]!.previousMultiplier), { type: 'deposit', at: new Date('2026-05-01T00:00:00Z'), raw: 1_000_000_000n });
    const availableShare = (s: typeof state) => positionView(s).availableQuantity.div(positionView(s).quantity);
    for (const h of window) {
      const t = await transition('HONx', h.activationDateTime);
      const before = state;
      state = applyEvent(state, { type: 'transition', transition: t, classification: classifyTransition(t, actions) });
      if (h.activationDateTime === '2026-06-29T23:55:00.000Z') {
        // The distribution scales principal and earlier dividend exposure alike: the convertible share of the position is unchanged.
        expect(positionView(before).availableQuantity.isZero()).toBe(false);
        expect(availableShare(state).eq(availableShare(before))).toBe(true);
        expect(positionView(state).dividendIncomeUsd.eq(positionView(before).dividendIncomeUsd)).toBe(true);
      }
    }
    expect(state.entries.map((e) => e.type)).toEqual(['deposit', 'dividend', 'split', 'distribution', 'dividend']);
    const spin = state.entries[3]!;
    expect(spin.type === 'distribution' && spin.distributedFraction.toFixed(5)).toBe('0.48747');
    // Proceeds = shares held (10 raw tokens × 0.51205 multiplier) × $216.66 — recorded, never income.
    expect(spin.type === 'distribution' && spin.proceedsUsd?.toFixed(2)).toBe('1109.43');
    expect(positionView(state).dividendIncomeUsd.compare(Rational.of(25n))).toBeLessThan(0);
  });

  it('never adds income or new convertible exposure, for any increasing multiplier (property)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 12n }), fc.double({ min: 0.1, max: 10, noNaN: true }), fc.double({ min: 1.0001, max: 3, noNaN: true }), (raw, before, growth) => {
        const after = before * growth;
        fc.pre(after > before && Number.isFinite(after));
        const classification: Classification = {
          kind: 'distribution',
          action: 'spin_off',
          classifier: 'validated',
          eventId: 'spin',
          version: 1,
          distributedFraction: Rational.fromFloat64(after).sub(Rational.fromFloat64(before)).div(Rational.fromFloat64(after)),
          proceedsUsdPerShare: null,
          warnings: [],
        };
        const held = applyEvent(openPosition('mint', 8, before), { type: 'deposit', at: new Date(0), raw });
        const next = replay(held, [{ type: 'transition', transition: { mint: 'mint', symbol: 'Px', before, after, activatedAt: new Date(1000) }, classification }]);
        expect(positionView(next).availableQuantity.eq(positionView(held).availableQuantity)).toBe(true);
        expect(positionView(next).dividendIncomeUsd.isZero()).toBe(true);
      }),
    );
  });
});

describe('size is not evidence (special-dividend trap, recorded data)', () => {
  it('four of six spin-offs raise the multiplier less than the largest cash dividend, so any size threshold misclassifies them', () => {
    const largestDividendIncrease = Math.max(
      ...actions
        .filter((a) => a.type === 'CashDividend' && a.multiplierOld !== null && a.multiplierNew !== null)
        .map((a) => Number(a.multiplierNew) / Number(a.multiplierOld) - 1),
    );
    const spinOffIncreases = actions
      .filter((a) => a.type === 'SpinOff' && a.multiplierOld !== null && a.multiplierNew !== null)
      .map((a) => Number(a.multiplierNew) / Number(a.multiplierOld) - 1);
    expect(largestDividendIncrease).toBeGreaterThan(0.029);
    expect(largestDividendIncrease).toBeLessThan(0.03);
    expect(spinOffIncreases.filter((x) => x < largestDividendIncrease)).toHaveLength(4);
  });
});
