/**
 * Late-arriving issuer data and corrections, replayed on recorded KOx data through the same
 * classifier → ledger → journal path the worker uses. Locks the demo's claims below the chain layer.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyEvent, classifyTransition, openPosition, type LedgerEntry, type PositionState } from '@corpact/accounting';
import type { IssuerCorporateAction, ObservedTransition } from '@corpact/domain';
import { createFixtureXStocksSource } from '@corpact/issuers';
import { journalValuesFromEntry, planJournal, type JournalValues, type OpenRecognition } from './journal';

const ACTIVATION = '2026-06-14T23:55:00.000Z';
let actions: IssuerCorporateAction[];
let transition: ObservedTransition;

beforeAll(async () => {
  const source = createFixtureXStocksSource();
  actions = (await source.corporateActions('history', { symbol: 'KOx' })).actions;
  const mint = (await source.listSolanaAssets()).find((a) => a.symbol === 'KOx')!.mint;
  const h = (await source.multiplierHistory('KOx')).history.find((x) => x.activationDateTime === ACTIVATION)!;
  transition = { mint, symbol: 'KOx', before: h.previousMultiplier, after: h.multiplier, activatedAt: new Date(ACTIVATION) };
});

/** Replay 20 KOx held before the activation and turn the resulting entry into journal values. */
function desired(evidence: readonly IssuerCorporateAction[]): JournalValues[] {
  let state: PositionState = openPosition(transition.mint, 8, transition.before);
  state = applyEvent(state, { type: 'deposit', at: new Date('2026-06-01T00:00:00Z'), raw: 2_000_000_000n });
  const classification = classifyTransition(transition, evidence);
  state = applyEvent(state, { type: 'transition', transition, classification });
  const entry = state.entries.at(-1) as LedgerEntry;
  const values = journalValuesFromEntry(entry, {
    multiplierVersionId: '42',
    actionMatchId: '1',
    issuerEventId: classification.kind === 'unclassified' ? null : classification.eventId,
    issuerRevision: classification.kind === 'unclassified' ? null : classification.version,
    effectiveUnix: BigInt(Date.parse(ACTIVATION) / 1000),
  });
  return values ? [values] : [];
}

const recognize = (values: readonly JournalValues[], firstId = 1): OpenRecognition[] => values.map((v, i) => ({ ...v, id: String(firstId + i) }));

describe('late-arriving issuer record', () => {
  it('stays unattributed before the record exists, then is replaced by a verified dividend once it arrives', () => {
    const early = desired([]);
    expect(early.map((v) => v.kind)).toEqual(['unclassified_adjustment']);
    expect(early[0]!.usd).toBeNull();

    const plan = planJournal(recognize(early), desired(actions));
    expect(plan.map((p) => p.type)).toEqual(['reversal', 'recognition']);
    expect(plan[1]).toMatchObject({ type: 'recognition', values: { kind: 'dividend' } });
    expect(plan[1]!.type === 'recognition' && plan[1]!.values.usd).not.toBeNull();
  });

  it('writes nothing when the same evidence is replayed again', () => {
    expect(planJournal(recognize(desired(actions)), desired(actions))).toEqual([]);
  });
});

describe('issuer correction', () => {
  it('reverses the original recognition and appends the corrected one, keeping both', () => {
    const original = recognize(desired(actions));
    const target = actions.find((a) => a.effectiveAt?.toISOString() === ACTIVATION)!;
    const corrected: IssuerCorporateAction = { ...target, version: target.version + 1, status: 'Corrected', netCashUsdPerShare: '0.35', withholdingTaxRate: '0.34', grossCashUsdPerShare: '0.53' };
    const replacement = desired([...actions, corrected]);

    const plan = planJournal(original, replacement);
    expect(plan.map((p) => [p.type, p.reason])).toEqual([
      ['reversal', 'issuer_correction'],
      ['recognition', 'issuer_correction'],
    ]);
    expect(plan[0]).toMatchObject({ reverses: { id: original[0]!.id, issuerRevision: target.version } });
    expect(plan[1]).toMatchObject({ values: { issuerRevision: target.version + 1 } });
    const before = original[0]!.usd!;
    const after = plan[1]!.type === 'recognition' ? plan[1]!.values.usd! : null;
    expect(after !== null && !after.eq(before)).toBe(true);
  });
});
