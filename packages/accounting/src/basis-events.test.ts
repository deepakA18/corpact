/**
 * Stock dividends, rights, identity changes and withholding refunds, validated against every recorded instance
 * (docs/findings/corporate-actions-census.md), plus the zero-instance kinds, which must never book.
 * Each trap is locked here against the recorded issuer data; nothing is fabricated to imply validation.
 */
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACTION_KIND_SPECS,
  Rational,
  deriveLifecycle,
  identityChangeLink,
  supersededRevisions,
  traceLineage,
  type Classification,
  type CorporateActionType,
  type IssuerCorporateAction,
  type ObservedTransition,
} from '@corpact/domain';
import { createFixtureXStocksSource } from '@corpact/issuers';
import { classifyTransition, latestVersions, standingVersions } from './classify';
import { applyEvent, openPosition, positionView, replay, type PositionState } from './ledger';

const source = createFixtureXStocksSource();
let history: IssuerCorporateAction[];
let upcoming: IssuerCorporateAction[];
const mints = new Map<string, string>();

beforeAll(async () => {
  history = (await source.corporateActions('history')).actions;
  upcoming = (await source.corporateActions('upcoming')).actions;
  for (const a of await source.listSolanaAssets()) mints.set(a.symbol, a.mint);
});

async function transition(symbol: string, iso: string): Promise<ObservedTransition> {
  const h = (await source.multiplierHistory(symbol)).history.find((x) => x.activationDateTime === iso);
  if (!h) throw new Error(`no ${symbol} change at ${iso}`);
  return { mint: mints.get(symbol)!, symbol, before: h.previousMultiplier, after: h.multiplier, activatedAt: new Date(iso) };
}

async function label(symbol: string, iso: string) {
  return (await source.multiplierHistory(symbol)).history.find((x) => x.activationDateTime === iso)?.reason;
}

const event = (actions: readonly IssuerCorporateAction[], prefix: string) =>
  actions.filter((a) => a.eventId.startsWith(prefix)).toSorted((a, b) => a.version - b.version);

const increase = (t: ObservedTransition) => t.after / t.before - 1;

/** The largest multiplier increase of any recorded cash dividend: the ceiling a size heuristic would use. */
const largestDividendIncrease = () =>
  Math.max(
    ...history
      .filter((a) => a.type === 'CashDividend' && a.multiplierOld !== null && a.multiplierNew !== null)
      .map((a) => Number(a.multiplierNew) / Number(a.multiplierOld) - 1),
  );

const held = (t: ObservedTransition, raw = 1_000_000_000n) => applyEvent(openPosition(t.mint, 8, t.before), { type: 'deposit', at: new Date(t.activatedAt.getTime() - 86_400_000), raw });
const availableShare = (s: PositionState) => positionView(s).availableQuantity.div(positionView(s).quantity);

describe('SCCOx 2026-08-12: a stock dividend whose type churned before delivery', () => {
  const ISO = '2026-08-12T00:30:00.000Z';

  it('replays the six issuer versions in publication order and resolves only on the delivered record', async () => {
    const versions = event([...history, ...upcoming], 'ed857d4c');
    expect(versions.map((v) => `v${v.version} ${v.status}`)).toEqual(['v1 Scheduled', 'v2 Cancelled', 'v3 Cancelled', 'v4 Scheduled', 'v5 Initial', 'v6 Cancelled']);
    expect(versions.map((v) => v.createdAt.getTime())).toEqual(versions.map((v) => v.createdAt.getTime()).toSorted((a, b) => a - b));
    expect(versions[1]!.notes).toMatch(/Will be a cash flow, not a unit change/);

    const t = await transition('SCCOx', ISO);
    const outcomes = versions.map((_, i) => classifyTransition(t, versions.slice(0, i + 1)));
    // Announcements and cancellations are never evidence of what happened.
    for (const c of outcomes.slice(0, 4)) expect(c).toMatchObject({ kind: 'unclassified', reasons: [expect.stringMatching(/No published issuer action/)] });
    // v5 delivers; v6 cancels the v4 schedule, not the delivery.
    for (const c of outcomes.slice(4)) expect(c).toMatchObject({ kind: 'split', action: 'stock_dividend', classifier: 'validated', eventId: versions[0]!.eventId, version: 5 });
    const final = outcomes[5]!;
    expect(final.kind === 'split' && final.factor.eq(Rational.fromFloat64(t.after).div(Rational.fromFloat64(t.before)))).toBe(true);
    expect(final.kind === 'split' && final.factor.toFixed(7)).toBe('1.0153176');
    // The ratio announced in v1 (1:1.012) is reported, never used.
    expect(final.kind === 'split' && final.warnings.join(' ')).toMatch(/version 1 \(Scheduled\) stated 1:1\.012; the delivered change is ×1\.015318/);
    // Taking the highest version instead would void the delivery.
    expect(latestVersions(versions)).toEqual([expect.objectContaining({ version: 6, status: 'Cancelled' })]);
  });

  it('records every superseding revision in the lifecycle instead of collapsing them', async () => {
    const versions = event([...history, ...upcoming], 'ed857d4c');
    const revisions = versions.map((v) => ({ version: v.version, type: v.type, status: v.status, createdAt: v.createdAt, notes: v.notes, sha256: null }));
    expect([...supersededRevisions(revisions)]).toEqual([[1, null], [2, 1], [3, 1], [4, null], [5, 4], [6, 4]]);
    const steps = deriveLifecycle({
      issuer: { eventId: versions[0]!.eventId, revisions },
      chain: { signature: 'multiplier-history', status: 'active', publishedAt: null, activatedAt: new Date(ISO), supersededAt: null },
      correctedAt: null,
      reversedAt: null,
    });
    expect(steps.map((s) => s.state)).toEqual(['announced', 'announced', 'announced', 'announced', 'announced', 'announced', 'activated']);
    expect(steps.map((s) => s.revision?.supersedes ?? null)).toEqual([null, 1, 1, null, 4, 4, null]);
    expect(steps[1]!.reason).toMatch(/cancelled the action, superseding v1 .*Will be a cash flow/);
  });

  it('books a quantity-basis adjustment with zero income, and the size of the change is no evidence', async () => {
    const t = await transition('SCCOx', ISO);
    expect(await label('SCCOx', ISO)).toBe('Dividend');
    const before = held(t);
    const after = applyEvent(before, { type: 'transition', transition: t, classification: classifyTransition(t, history) });
    const entry = after.entries.at(-1)!;
    expect(entry).toMatchObject({ type: 'split', action: 'stock_dividend' });
    expect(entry.type === 'split' && entry.quantityDelta.compare(Rational.ZERO) > 0).toBe(true);
    expect(positionView(after).dividendIncomeUsd.isZero()).toBe(true);
    expect(positionView(after).availableQuantity.isZero()).toBe(true);
    // +1.53%: inside the cash-dividend size range, so any size threshold books it as income.
    expect(increase(t)).toBeLessThan(largestDividendIncrease());
  });
});

describe('KRAQx 2026-03-26: rights sold and reinvested, mislabelled by the issuer as UnitSplit', () => {
  const ISO = '2026-03-26T23:55:00.000Z';

  it('is a rights distribution on the corrected record, with the mislabel stated', async () => {
    const versions = event(history, '25ca1d3c');
    expect(versions.map((v) => `v${v.version} ${v.status} ${v.type}`)).toEqual(['v1 Initial UnitSplit', 'v2 Cancelled UnitSplit', 'v3 Corrected UnitSplit']);
    const t = await transition('KRAQx', ISO);
    const c = classifyTransition(t, history);
    expect(c).toMatchObject({ kind: 'distribution', action: 'rights_distribution', classifier: 'validated', version: 3 });
    if (c.kind !== 'distribution') return;
    expect(c.warnings[0]).toMatch(/labelled this UnitSplit, but a 1:1 unit ratio cannot change the multiplier; its note reports rights \(warrants\) sold/);
    expect(c.warnings.join(' ')).toMatch(/Selling proceeds of 18,606 warrants/);
    expect(c.distributedFraction.eq(Rational.fromFloat64(t.after).sub(Rational.fromFloat64(t.before)).div(Rational.fromFloat64(t.after)))).toBe(true);
    expect(c.distributedFraction.toFixed(5)).toBe('0.01357');
    expect(c.proceedsUsdPerShare?.eq(Rational.fromDecimal('0.1356647'))).toBe(true);
  });

  it('never uses the version cancelled for a fee miscalculation', async () => {
    const [v1] = event(history, '25ca1d3c');
    const t = await transition('KRAQx', ISO);
    const atCancelledValues = classifyTransition({ ...t, after: Number(v1!.multiplierNew) }, history);
    expect(atCancelledValues).toMatchObject({ kind: 'unclassified', reasons: [expect.stringMatching(/No published issuer action/)] });
  });

  it('without the note naming the rights, the same record stays an unclassified unit split that does not reconcile', async () => {
    const t = await transition('KRAQx', ISO);
    const withoutNote = history.map((a) => (a.eventId.startsWith('25ca1d3c') ? { ...a, notes: null } : a));
    expect(classifyTransition(t, withoutNote)).toMatchObject({ kind: 'unclassified', action: 'unit_split', reasons: [expect.stringMatching(/does not reconcile/)] });
  });

  it('books a basis allocation with no income; +1.38% is inside the dividend size range', async () => {
    const t = await transition('KRAQx', ISO);
    const before = held(t);
    const after = applyEvent(before, { type: 'transition', transition: t, classification: classifyTransition(t, history) });
    expect(after.entries.at(-1)).toMatchObject({ type: 'distribution', action: 'rights_distribution' });
    expect(positionView(after).dividendIncomeUsd.isZero()).toBe(true);
    expect(positionView(after).availableQuantity.isZero()).toBe(true);
    expect(increase(t)).toBeLessThan(largestDividendIncrease());
  });
});

describe('AZNx 2026-02-02: NASDAQ ADR → NYSE ordinary share, labelled StockMerger and "ReverseSplit"', () => {
  const ISO = '2026-02-02T22:00:00.000Z';
  const HONX_REVERSE = '2026-06-29T15:30:00.000Z';

  it('is an identity change at exactly 1:2, with both listings taken from the issuer note', async () => {
    expect(await label('AZNx', ISO)).toBe('ReverseSplit');
    const c = classifyTransition(await transition('AZNx', ISO), history);
    expect(c).toMatchObject({ kind: 'identity_change', action: 'identity_change', classifier: 'validated', fromUnderlying: 'NASDAQ:AZN (ADR)', toUnderlying: 'NYSE:AZN' });
    expect(c.kind === 'identity_change' && c.factor.eq(Rational.of(1n, 2n))).toBe(true);
  });

  it('has the same multiplier ratio as a real reverse split: size cannot tell them apart, evidence can', async () => {
    const azn = await transition('AZNx', ISO);
    const hon = await transition('HONx', HONX_REVERSE);
    const ratio = (t: ObservedTransition) => Rational.fromFloat64(t.after).div(Rational.fromFloat64(t.before));
    expect(ratio(azn).eq(Rational.of(1n, 2n))).toBe(true);
    expect(ratio(hon).eq(Rational.of(1n, 2n))).toBe(true);
    expect(classifyTransition(hon, history)).toMatchObject({ kind: 'split', action: 'reverse_split' });
  });

  it('degrades to an unvalidated, unbooked stock merger when the note is missing or names another company', async () => {
    const t = await transition('AZNx', ISO);
    const edit = (notes: string | null) => history.map((a) => (a.eventId.startsWith('c8815421') ? { ...a, notes } : a));
    expect(classifyTransition(t, edit(null))).toMatchObject({ kind: 'unclassified', action: 'stock_merger', classifier: 'unvalidated' });
    expect(classifyTransition(t, edit('Stock Merger 0.5 NYSE:GSK for 1 NASDAQ:AZN (ADR)'))).toMatchObject({
      kind: 'unclassified',
      classifier: 'unvalidated',
      reasons: [expect.stringMatching(/a different company/)],
    });
  });

  it('replays the real AZNx history across the conversion: income only from dividends, convertible share unchanged', async () => {
    const all = (await source.multiplierHistory('AZNx')).history.toSorted((a, b) => a.activationDateTime.localeCompare(b.activationDateTime));
    const first = all[0]!;
    let state = applyEvent(openPosition(mints.get('AZNx')!, 8, first.previousMultiplier), { type: 'deposit', at: new Date(0), raw: 2_000_000_000n });
    let incomeAtConversion: Rational | null = null;
    for (const h of all) {
      const t = await transition('AZNx', h.activationDateTime);
      const c = classifyTransition(t, history);
      const before = state;
      state = applyEvent(state, { type: 'transition', transition: t, classification: c });
      if (h.activationDateTime === ISO) {
        expect(availableShare(state).eq(availableShare(before))).toBe(true);
        expect(positionView(state).quantity.eq(positionView(before).quantity.mul(Rational.of(1n, 2n)))).toBe(true);
        incomeAtConversion = positionView(state).dividendIncomeUsd;
        expect(incomeAtConversion.eq(positionView(before).dividendIncomeUsd)).toBe(true);
      }
    }
    const types = state.entries.map((e) => e.type);
    expect(types.filter((x) => x === 'identity_change')).toHaveLength(1);
    expect(types.filter((x) => x !== 'deposit' && x !== 'dividend' && x !== 'identity_change')).toEqual([]);
    expect(incomeAtConversion).not.toBeNull();
  });

  it('writes a lineage link that carries all basis to the new listing and traces end to end', async () => {
    const c = classifyTransition(await transition('AZNx', ISO), history);
    if (c.kind !== 'identity_change') throw new Error('expected an identity change');
    const mint = mints.get('AZNx')!;
    const from = { mint, symbol: 'AZNx', underlyingSymbol: c.fromUnderlying, underlyingIsin: null };
    const to = { mint, symbol: 'AZNx', underlyingSymbol: c.toUnderlying, underlyingIsin: null };
    const link = identityChangeLink({ at: new Date(ISO), issuerEventId: c.eventId, from, to, quantityFactor: c.factor });
    expect(traceLineage(from, [link])).toEqual([{ instrument: to, basisFraction: Rational.ONE, terminated: false }]);
  });
});

describe('withholding refunds arrive as new dividends (LINx, NVOx)', () => {
  const CASES = [
    // symbol, original dividend, refund, event, original net, refund, original gross
    ['LINx', '2026-03-11T00:15:00.000Z', '2026-03-26T23:55:00.000Z', '5cedd8fc', '1.12', '0.48', '1.6'],
    ['NVOx', '2025-08-26T23:55:00.000Z', '2025-09-05T23:55:00.000Z', '52063999', '0.2883412', '0.1232128', '0.411554'],
  ] as const;

  it.each(CASES)('%s: the refund is a withholding adjustment, and the original dividend keeps its evidence', async (symbol, originalIso, refundIso, prefix, net, refund, gross) => {
    const original = classifyTransition(await transition(symbol, originalIso), history);
    const refunded = classifyTransition(await transition(symbol, refundIso), history);
    expect(original).toMatchObject({ kind: 'dividend', action: 'cash_dividend', eventId: expect.stringMatching(new RegExp(`^${prefix}`)), refundNote: null });
    expect(refunded).toMatchObject({ kind: 'dividend', action: 'withholding_adjustment', classifier: 'validated', eventId: expect.stringMatching(new RegExp(`^${prefix}`)) });
    expect(refunded.kind === 'dividend' && refunded.refundNote).toMatch(/WHT/);
    expect(refunded.kind === 'dividend' && refunded.warnings.some((w) => /inconsistent/.test(w))).toBe(false);
    // Withholding is deducted once: net of the original plus the refund is exactly the original gross.
    const sum = (original.kind === 'dividend' ? original.netCashUsdPerShare! : Rational.ZERO).add(refunded.kind === 'dividend' ? refunded.netCashUsdPerShare! : Rational.ZERO);
    expect(sum.eq(Rational.fromDecimal(gross))).toBe(true);
    expect(original.kind === 'dividend' && original.netCashUsdPerShare!.eq(Rational.fromDecimal(net))).toBe(true);
    expect(refunded.kind === 'dividend' && refunded.netCashUsdPerShare!.eq(Rational.fromDecimal(refund))).toBe(true);
    // The trap: treating the refund version as a replacement voids the original dividend.
    expect(latestVersions(event(history, prefix)).map((a) => a.version)).toEqual([event(history, prefix).at(-1)!.version]);
    expect(standingVersions(event(history, prefix)).map((a) => a.status)).toEqual([expect.stringMatching(/Initial/), 'Corrected']);
  });

  it('LINx: a held position books the original net and the refund once each, and the refund is within the dividend size range', async () => {
    const [, originalIso, refundIso] = CASES[0];
    const first = await transition('LINx', originalIso);
    const second = await transition('LINx', refundIso);
    const state = replay(held(first), [
      { type: 'transition', transition: first, classification: classifyTransition(first, history) },
      { type: 'transition', transition: second, classification: classifyTransition(second, history) },
    ]);
    const [, a, b] = state.entries;
    expect([a, b].map((e) => e?.type === 'dividend' && e.action)).toEqual(['cash_dividend', 'withholding_adjustment']);
    const shares = (t: ObservedTransition) => Rational.of(10n).mul(Rational.fromFloat64(t.before));
    expect(positionView(state).dividendIncomeUsd.eq(shares(first).mul(Rational.fromDecimal('1.12')).add(shares(second).mul(Rational.fromDecimal('0.48'))))).toBe(true);
    expect(increase(second)).toBeLessThan(largestDividendIncrease());
  });

  it('without the issuer note, a zero-gross record is an ordinary dividend with its inconsistency flagged', async () => {
    const [, , refundIso, prefix] = CASES[0];
    const withoutNote = history.map((a) => (a.eventId.startsWith(prefix) && a.version === 3 ? { ...a, notes: null } : a));
    const c = classifyTransition(await transition('LINx', refundIso), withoutNote);
    expect(c).toMatchObject({ kind: 'dividend', action: 'cash_dividend', refundNote: null });
    expect(c.kind === 'dividend' && c.warnings.join(' ')).toMatch(/inconsistent/);
  });
});

describe('the 5% currency retention is not withholding tax', () => {
  it.each([
    ['ETNx', '2026-05-08T00:30:00.000Z', '0.825', '0.78375'],
    ['ASMLx', '2026-04-25T02:00:00.000Z', '2.700527', '2.56550065'],
    ['LINx', '2026-06-04T00:30:00.000Z', '1.6', '1.52'],
  ])('%s %s: retention recognised, net used once, nothing flagged', async (symbol, iso, gross, net) => {
    const c = classifyTransition(await transition(symbol, iso), history);
    expect(c).toMatchObject({ kind: 'dividend', action: 'cash_dividend', warnings: [] });
    if (c.kind !== 'dividend') return;
    expect(c.retentionRate?.eq(Rational.fromDecimal('0.05'))).toBe(true);
    expect(c.netCashUsdPerShare?.eq(Rational.fromDecimal(net))).toBe(true);
    expect(Rational.fromDecimal(gross).mul(Rational.fromDecimal('0.95')).eq(c.netCashUsdPerShare!)).toBe(true);
  });

  it('TSMx 2026-06-11: a dividend that releases an earlier retention is not flagged as a gap', async () => {
    const c = classifyTransition(await transition('TSMx', '2026-06-11T00:30:00.000Z'), history);
    expect(c).toMatchObject({ kind: 'dividend', action: 'cash_dividend', warnings: [], retentionRate: null });
  });
});

describe('zero-instance kinds are recognised, labelled unvalidated, and never booked', () => {
  const TYPES: Array<[CorporateActionType, string]> = [
    ['CashMerger', 'cash_merger'],
    ['StockAndCashMerger', 'mixed_merger'],
    ['Redemption', 'redemption'],
    ['WorthlessRemoval', 'delisting'],
    ['NameChange', 'identity_change'],
    ['CashAndStockDividend', 'cash_and_stock_dividend'],
    ['RightsDistribution', 'rights_distribution'],
  ];

  it.each(TYPES)('an issuer %s matching a real multiplier change is not booked', async (type, kind) => {
    // A real SPYx dividend with only its type changed: tests routing, and implies nothing about how such an action is delivered.
    const t = await transition('SPYx', '2026-06-18T04:00:00.000Z');
    const retyped = history.map((a) => (a.symbol === 'SPYx' && a.effectiveAt?.toISOString() === t.activatedAt.toISOString() ? { ...a, type } : a));
    const c = classifyTransition(t, retyped);
    expect(c).toMatchObject({ kind: 'unclassified', action: kind, classifier: 'unvalidated', reasons: [expect.stringMatching(/unvalidated; not booked/)] });
    const state = applyEvent(held(t), { type: 'transition', transition: t, classification: c });
    expect(positionView(state).dividendIncomeUsd.isZero()).toBe(true);
    expect(positionView(state).availableQuantity.isZero()).toBe(true);
  });

  it('a split publishing cash (fractional cash in lieu) is recognised and not booked', async () => {
    const t = await transition('HONx', '2026-06-29T15:30:00.000Z');
    const withCash = history.map((a) => (a.symbol === 'HONx' && a.type === 'ReverseSplit' ? { ...a, grossCashUsdPerShare: '12.5' } : a));
    expect(classifyTransition(t, withCash)).toMatchObject({ kind: 'unclassified', action: 'cash_in_lieu', classifier: 'unvalidated' });
  });

  it('no zero-instance kind claims validation, and seizure has no classifier at all', () => {
    for (const kind of ['cash_merger', 'mixed_merger', 'redemption', 'delisting', 'cash_and_stock_dividend', 'cash_in_lieu', 'stock_merger', 'unit_split'] as const) {
      expect(ACTION_KIND_SPECS[kind]).toMatchObject({ realInstances: 0, classifier: 'unvalidated', treatment: 'not_booked' });
    }
    expect(ACTION_KIND_SPECS.seizure).toMatchObject({ realInstances: 0, classifier: 'not_built', treatment: 'not_booked' });
  });
});

describe('basis conservation (property)', () => {
  const position = (raw: bigint, before: number) => applyEvent(openPosition('mint', 8, before), { type: 'deposit', at: new Date(0), raw });
  const tx = (before: number, after: number): ObservedTransition => ({ mint: 'mint', symbol: 'Px', before, after, activatedAt: new Date(1000) });

  it('a stock dividend or identity change rescales principal exactly and adds no income or convertible exposure', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        fc.boolean(),
        (raw, before, n, d, identity) => {
          const factor = Rational.of(BigInt(n), BigInt(d));
          const after = factor.mul(Rational.fromFloat64(before)).toNumber();
          fc.pre(Number.isFinite(after) && after > 0 && Rational.fromFloat64(after).div(Rational.fromFloat64(before)).eq(factor));
          const classification: Classification = identity
            ? { kind: 'identity_change', action: 'identity_change', classifier: 'validated', eventId: 'e', version: 1, factor, fromUnderlying: 'A', toUnderlying: 'B', warnings: [] }
            : { kind: 'split', action: 'stock_dividend', classifier: 'validated', eventId: 'e', version: 1, factor, warnings: [] };
          const start = position(raw, before);
          const next = replay(start, [{ type: 'transition', transition: tx(before, after), classification }]);
          expect(next.floor.eq(start.floor.mul(factor))).toBe(true);
          expect(positionView(next).availableQuantity.isZero()).toBe(true);
          expect(positionView(next).dividendIncomeUsd.isZero()).toBe(true);
        },
      ),
    );
  });

  it('an identity change link carries exactly all basis for any ratio, and chains conserve it', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 50 })), { minLength: 1, maxLength: 5 }), (ratios) => {
        const refs = ratios.map((_, i) => ({ mint: 'm', symbol: 'Px', underlyingSymbol: `L${i}`, underlyingIsin: null }));
        const start = { mint: 'm', symbol: 'Px', underlyingSymbol: 'START', underlyingIsin: null };
        const links = ratios.map(([n, d], i) =>
          identityChangeLink({ at: new Date(i * 1000), issuerEventId: `e${i}`, from: i === 0 ? start : refs[i - 1]!, to: refs[i]!, quantityFactor: Rational.of(BigInt(n), BigInt(d)) }),
        );
        const traced = traceLineage(start, links);
        expect(traced).toHaveLength(1);
        expect(traced[0]!.instrument).toEqual(refs.at(-1));
        expect(traced[0]!.basisFraction.eq(Rational.ONE)).toBe(true);
      }),
    );
  });
});
