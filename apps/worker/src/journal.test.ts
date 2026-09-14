import { describe, expect, it } from 'vitest';
import { classifyTransition, openPosition, replay, type LedgerEntry } from '@corpact/accounting';
import { Rational, type Classification, type ObservedTransition } from '@corpact/domain';
import { createFixtureXStocksSource } from '@corpact/issuers';
import { JournalInvariantError, journalValuesFromEntry, planJournal, type JournalValues, type OpenRecognition } from './journal';

const values = (overrides: Partial<JournalValues> = {}): JournalValues => ({
  multiplierVersionId: '1',
  kind: 'dividend',
  effectiveUnix: 1_781_481_300n,
  quantity: Rational.fromDecimal('0.0905976307'),
  splitFactor: null,
  usd: Rational.fromDecimal('7.4851762504'),
  valuation: 'issuer_net_cash',
  actionMatchId: '9',
  issuerEventId: 'evt',
  issuerRevision: 1,
  ...overrides,
});
const open = (v: JournalValues, id = '100'): OpenRecognition => ({ ...v, id });

describe('planJournal', () => {
  it('recognizes new entries as initial', () => {
    expect(planJournal([], [values()])).toEqual([{ type: 'recognition', values: values(), reason: 'initial', detail: null }]);
  });

  it('writes nothing when the replay reproduces what was recognized', () => {
    expect(planJournal([open(values())], [values({ actionMatchId: '10' })])).toEqual([]);
  });

  it('reverses and replaces on an issuer correction, never editing the original', () => {
    const before = open(values());
    const after = values({ issuerRevision: 2, usd: Rational.fromDecimal('7.2') });
    const plan = planJournal([before], [after]);
    expect(plan.map((p) => [p.type, p.reason])).toEqual([
      ['reversal', 'issuer_correction'],
      ['recognition', 'issuer_correction'],
    ]);
    expect(plan[0]).toMatchObject({ reverses: before });
    expect(plan[1]?.detail).toBe('dividend per issuer action evt revision 1 → dividend per issuer action evt revision 2');
  });

  it('labels quantity changes from late history and valuation-only changes separately', () => {
    const before = open(values());
    expect(planJournal([before], [values({ quantity: Rational.fromDecimal('0.1') })])[0]?.reason).toBe('balance_history_changed');
    expect(planJournal([before], [values({ usd: null, valuation: null })])[0]?.reason).toBe('valuation_changed');
  });

  it('reverses a recognition the replay no longer produces', () => {
    const before = open(values());
    expect(planJournal([before], [])).toEqual([
      { type: 'reversal', reverses: before, reason: 'no_longer_applicable', detail: 'The ledger replay no longer produces this entry' },
    ]);
  });

  it('refuses a journal with two open recognitions for one transition', () => {
    expect(() => planJournal([open(values(), '1'), open(values(), '2')], [])).toThrow(JournalInvariantError);
  });
});

describe('real issuer revisions: STRCx event c5721924 (recorded corporate-action history)', () => {
  const EVENT = 'c5721924-4b13-4c29-81db-cf075a49ba2d';

  it('stays unclassified through every revision that does not match the chain, then journals one correction', async () => {
    const source = createFixtureXStocksSource();
    const { actions } = await source.corporateActions('history', { symbol: 'STRCx' });
    const { history } = await source.multiplierHistory('STRCx');
    const mint = (await source.listSolanaAssets()).find((a) => a.symbol === 'STRCx')!.mint;
    const node = history.find((h) => h.activationDateTime === '2026-08-30T23:55:00.000Z')!;
    const transition: ObservedTransition = {
      mint,
      symbol: 'STRCx',
      before: node.previousMultiplier,
      after: node.multiplier,
      activatedAt: new Date(node.activationDateTime),
    };

    const revisions = actions.filter((a) => a.eventId === EVENT).sort((a, b) => a.version - b.version);
    const others = actions.filter((a) => a.eventId !== EVENT);
    // Classify as the issuer's record stood after each revision was published.
    const asPublished = revisions.map((rev) => ({
      rev,
      classification: classifyTransition(transition, [...others, ...revisions.filter((r) => r.version <= rev.version)]),
    }));
    expect(revisions.length).toBeGreaterThanOrEqual(5);
    expect(asPublished.slice(0, -1).every((s) => s.classification.kind === 'unclassified')).toBe(true);
    expect(asPublished.at(-1)).toMatchObject({ rev: { version: 8, status: 'Corrected' }, classification: { kind: 'dividend', version: 8 } });

    const entryFor = (classification: Classification): LedgerEntry => {
      const state = replay(openPosition(mint, 8, transition.before), [
        { type: 'deposit', at: new Date('2026-08-01T00:00:00Z'), raw: 100_000_000n },
        { type: 'transition', transition, classification },
      ]);
      return state.entries.at(-1)!;
    };
    const link = (c: Classification) => ({
      multiplierVersionId: '42',
      actionMatchId: null,
      issuerEventId: c.kind === 'unclassified' ? null : c.eventId,
      issuerRevision: c.kind === 'unclassified' ? null : c.version,
      effectiveUnix: BigInt(transition.activatedAt.getTime() / 1000),
    });

    const first = asPublished[0]!.classification;
    const initial = planJournal([], [journalValuesFromEntry(entryFor(first), link(first))!]);
    expect(initial.map((p) => [p.type, p.reason])).toEqual([['recognition', 'initial']]);

    const recognized = initial[0]!.type === 'recognition' ? { ...initial[0]!.values, id: '1' } : null;
    const last = asPublished.at(-1)!.classification;
    const corrected = planJournal([recognized!], [journalValuesFromEntry(entryFor(last), link(last))!]);
    expect(corrected.map((p) => [p.type, p.reason])).toEqual([
      ['reversal', 'issuer_correction'],
      ['recognition', 'issuer_correction'],
    ]);
    expect(corrected[1]?.detail).toBe(`unclassified adjustment → dividend per issuer action ${EVENT} revision 8`);
    // Same shares either way: the correction changes what the change *was*, not its size.
    expect(corrected[1]?.type === 'recognition' && corrected[1].values.quantity.eq(recognized!.quantity)).toBe(true);
  });
});
