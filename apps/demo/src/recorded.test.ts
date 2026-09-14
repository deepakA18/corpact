/**
 * Pins the demo's recorded-data claims and the one-page summary: if the classifier or the
 * recording changes, these fail before anything wrong is shown to Backed or a buyer.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { honxSpinOff, loadRecorded, strcxImplausibleCash, summarize, type RecordedTransition } from './recorded';

let rows: RecordedTransition[];
beforeAll(async () => {
  rows = await loadRecorded();
});

describe('recorded universe summary', () => {
  it('matches the Phase 0 classification of all 654 changes', () => {
    const s = summarize(rows);
    expect(s).toMatchObject({ transitions: 654, dividends: { total: 628 }, splits: { total: 9 }, unclassified: { total: 17 } });
    expect(s.splits.byIssuerType).toEqual({ ForwardSplit: 8, ReverseSplit: 1 });
    expect(s.unclassified.byReason).toEqual({
      'SpinOff: no income policy': 6,
      'StockMerger: no income policy': 1,
      'StockDividend: no income policy': 1,
      'Split ratio does not reconcile with the multipliers': 1,
      'No issuer action published for the change': 8,
    });
  });

  it('finds 24 multiplier increases that are not cash dividends: 16 with a non-dividend issuer action, 8 with none', () => {
    const increases = summarize(rows).increasesNotCashDividends;
    expect(increases).toHaveLength(24);
    expect(increases.filter((r) => r.action !== null)).toHaveLength(16);
    expect(increases.filter((r) => r.action === null)).toHaveLength(8);
  });

  it('flags the history labels issuer evidence contradicts, including GMEx and AZNx', () => {
    const labels = summarize(rows).labelMismatches.map((r) => `${r.symbol} ${r.historyReason} ${r.transition.activatedAt.toISOString().slice(0, 10)}`);
    expect(labels).toEqual(expect.arrayContaining(['GMEx Dividend 2025-10-08', 'AZNx ReverseSplit 2026-02-02']));
  });
});

describe('side-by-side cases', () => {
  it('HONx: the naive reading books +95% as income; Corpact books none, citing the SpinOff', () => {
    const c = honxSpinOff(rows);
    expect(c.naive.reading).toMatch(/^Books 95\.11% more shares as dividend income, worth the issuer's \$216\.66 per share held$/);
    expect(c.corpact.outcome).toBe('Unclassified adjustment — no income booked');
    expect(c.corpact.reason).toMatch(/SpinOff .* has no income policy/);
  });

  it('STRCx: the naive reading books $0.627/share; Corpact refuses a $953k implied price and leaves USD unknown', () => {
    const c = strcxImplausibleCash(rows);
    expect(c.naive.reading).toMatch(/\$0\.62708331 of income per share held/);
    expect(c.impliedPriceUsd).toMatch(/^953\d{3}\.\d{2}$/);
    expect(Number(c.peerMedianUsd)).toBeGreaterThan(50);
    expect(Number(c.peerMedianUsd)).toBeLessThan(200);
    expect(c.corpact.outcome).toBe('Dividend recognized — USD unknown');
  });
});
