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
  it('classifies all 654 changes from evidence', () => {
    const s = summarize(rows);
    expect(s).toMatchObject({
      transitions: 654,
      dividends: { total: 630 },
      splits: { total: 10 },
      distributions: { total: 7 },
      identityChanges: { total: 1 },
      unclassified: { total: 6 },
    });
    expect(s.splits.byIssuerType).toEqual({ ForwardSplit: 8, ReverseSplit: 1, StockDividend: 1 });
    expect(s.unclassified.byReason).toEqual({ 'No issuer action published for the change': 6 });
  });

  it('finds 22 multiplier increases that are not cash dividends: 16 with a non-dividend issuer action, 6 with none', () => {
    const increases = summarize(rows).increasesNotCashDividends;
    expect(increases).toHaveLength(22);
    expect(increases.filter((r) => r.action !== null)).toHaveLength(16);
    expect(increases.filter((r) => r.action === null)).toHaveLength(6);
  });

  it('flags the history labels issuer evidence contradicts, including GMEx and AZNx', () => {
    const labels = summarize(rows).labelMismatches.map((r) => `${r.symbol} ${r.historyReason} ${r.transition.activatedAt.toISOString().slice(0, 10)}`);
    expect(labels).toEqual(expect.arrayContaining(['GMEx Dividend 2025-10-08', 'AZNx ReverseSplit 2026-02-02']));
  });
});

describe('side-by-side cases', () => {
  it('HONx: the naive reading books +95% as income; Corpact books a basis allocation, citing the SpinOff', () => {
    const c = honxSpinOff(rows);
    expect(c.naive.reading).toMatch(/^Books 95\.11% more shares as dividend income, worth the issuer's \$216\.66 per share held$/);
    expect(c.corpact.outcome).toBe('Spin-off — basis allocation, no income booked');
    expect(c.corpact.reason).toMatch(/^Issuer SpinOff ca3da1bc; distributed share .* = 0\.48747/);
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
