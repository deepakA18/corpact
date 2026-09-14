import { classifyTransition, latestVersions, sameF64 } from '@corpact/accounting';
import { Rational, type Classification, type IssuerCorporateAction, type ObservedTransition } from '@corpact/domain';
import { createFixtureXStocksSource, type IssuerSource } from '@corpact/issuers';

/**
 * The recorded issuer data set (fixtures/xstocks/recorded-20260913) run through the classifier,
 * with the naive readings it replaces. Reads recorded files only: no network, no live issuer feed.
 */

export interface RecordedTransition {
  symbol: string;
  transition: ObservedTransition;
  /** The multiplier-history `reason` label — what a naive reader would trust. */
  historyReason: string;
  classification: Classification;
  /** The issuer corporate action whose multipliers match, if any. */
  action: IssuerCorporateAction | null;
}

export const RECORDING = 'fixtures/xstocks/recorded-20260913';

function matchingAction(t: ObservedTransition, actions: readonly IssuerCorporateAction[]): IssuerCorporateAction | null {
  return (
    latestVersions(actions.filter((a) => a.symbol === t.symbol)).find(
      (a) =>
        (a.status === 'Initial' || a.status === 'Corrected') &&
        a.multiplierOld !== null &&
        a.multiplierNew !== null &&
        sameF64(Number(a.multiplierOld), t.before) &&
        sameF64(Number(a.multiplierNew), t.after),
    ) ?? null
  );
}

export async function loadRecorded(source: IssuerSource = createFixtureXStocksSource()): Promise<RecordedTransition[]> {
  const { actions, rejected } = await source.corporateActions('history');
  if (rejected.length > 0) throw new Error(`${rejected.length} recorded corporate actions failed validation`);
  const rows: RecordedTransition[] = [];
  for (const asset of await source.listSolanaAssets()) {
    const { history, rejected: badHistory } = await source.multiplierHistory(asset.symbol);
    if (badHistory.length > 0) throw new Error(`${asset.symbol}: ${badHistory.length} recorded multiplier changes failed validation`);
    for (const h of history.toSorted((a, b) => a.activationDateTime.localeCompare(b.activationDateTime))) {
      const transition: ObservedTransition = {
        mint: asset.mint,
        symbol: asset.symbol,
        before: h.previousMultiplier,
        after: h.multiplier,
        activatedAt: new Date(h.activationDateTime),
      };
      rows.push({ symbol: asset.symbol, transition, historyReason: h.reason, classification: classifyTransition(transition, actions), action: matchingAction(transition, actions) });
    }
  }
  return rows;
}

const count = <T>(items: readonly T[], key: (item: T) => string) =>
  items.reduce<Record<string, number>>((tally, item) => ({ ...tally, [key(item)]: (tally[key(item)] ?? 0) + 1 }), {});

/** A short label for why a change was not attributed. */
export function unclassifiedCategory(reasons: readonly string[]): string {
  const text = reasons.join(' ');
  const policy = /Issuer action (\w+) \(/.exec(text);
  if (policy) return `${policy[1]}: no income policy`;
  if (/does not reconcile/.test(text)) return 'Split ratio does not reconcile with the multipliers';
  if (/No published issuer action/.test(text)) return 'No issuer action published for the change';
  if (/effective time/.test(text)) return 'Issuer effective time differs from the chain';
  if (/issuer actions match/.test(text)) return 'More than one issuer action matches';
  return 'Other';
}

function dividendCategory(warnings: readonly string[]): string {
  const text = warnings.join(' ');
  if (/implies reinvestment/.test(text)) return 'Issuer cash implausible against the shares delivered: USD unknown';
  if (/no net cash/.test(text)) return 'No issuer net cash: USD unknown';
  if (/derived from gross/.test(text)) return 'Net cash derived from gross × (1 − withholding)';
  if (/inconsistent/.test(text)) return 'Valued, with inconsistent issuer gross/withholding/net flagged';
  return 'Valued from issuer net cash';
}

const LABEL_IMPLIES: Record<string, Classification['kind']> = { Dividend: 'dividend', ForwardSplit: 'split', ReverseSplit: 'split', StockSplit: 'split' };

export function summarize(rows: readonly RecordedTransition[]) {
  const dividends = rows.filter((r) => r.classification.kind === 'dividend');
  const splits = rows.filter((r) => r.classification.kind === 'split');
  const unclassified = rows.filter((r) => r.classification.kind === 'unclassified');
  return {
    transitions: rows.length,
    assets: new Set(rows.map((r) => r.symbol)).size,
    dividends: {
      total: dividends.length,
      byOutcome: count(dividends, (r) => (r.classification.kind === 'dividend' ? dividendCategory(r.classification.warnings) : '')),
    },
    splits: { total: splits.length, byIssuerType: count(splits, (r) => r.action?.type ?? 'unknown') },
    unclassified: {
      total: unclassified.length,
      byReason: count(unclassified, (r) => (r.classification.kind === 'unclassified' ? unclassifiedCategory(r.classification.reasons) : '')),
    },
    /** "Any multiplier increase is income": increases the classifier did not confirm as cash dividends. */
    increasesNotCashDividends: rows.filter((r) => r.transition.after > r.transition.before && r.classification.kind !== 'dividend'),
    /** The multiplier-history label says one thing; issuer evidence says another. */
    labelMismatches: rows.filter((r) => {
      const implied = LABEL_IMPLIES[r.historyReason];
      return implied !== undefined && implied !== r.classification.kind;
    }),
  };
}

export interface SideBySide {
  title: string;
  symbol: string;
  activatedAt: string;
  multiplierBefore: number;
  multiplierAfter: number;
  historyReason: string;
  issuerAction: string;
  naive: { rule: string; reading: string };
  corpact: { outcome: string; reading: string; reason: string };
}

const find = (rows: readonly RecordedTransition[], symbol: string, iso: string) => {
  const row = rows.find((r) => r.symbol === symbol && r.transition.activatedAt.toISOString() === iso);
  if (!row) throw new Error(`No recorded ${symbol} change at ${iso}`);
  return row;
};
const exactRatio = (after: number, before: number) => Rational.fromFloat64(after).div(Rational.fromFloat64(before));
const percent = (r: Rational, places: number) => `${r.sub(Rational.ONE).mul(Rational.of(100n)).toFixed(places)}%`;

/** HONx 2026-06-29: a spin-off that nearly doubles the multiplier. */
export function honxSpinOff(rows: readonly RecordedTransition[]): SideBySide {
  const row = find(rows, 'HONx', '2026-06-29T23:55:00.000Z');
  const { before, after } = row.transition;
  const gain = percent(exactRatio(after, before), 2);
  const cash = row.action?.grossCashUsdPerShare ?? null;
  return {
    title: 'HONx spin-off: a +95% multiplier change that is not income',
    symbol: row.symbol,
    activatedAt: row.transition.activatedAt.toISOString(),
    multiplierBefore: before,
    multiplierAfter: after,
    historyReason: row.historyReason,
    issuerAction: `${row.action?.type ?? 'none'} (${row.action?.eventId.slice(0, 8) ?? '—'}), issuer cash figure $${cash ?? '—'} per share`,
    naive: {
      rule: 'Any multiplier increase is a dividend',
      reading: `Books ${gain} more shares as dividend income${cash ? `, worth the issuer's $${Number(cash).toFixed(2)} per share held` : ''}`,
    },
    corpact: {
      outcome: row.classification.kind === 'unclassified' ? 'Unclassified adjustment — no income booked' : row.classification.kind,
      reading: `Shows the ${gain} unit change as pending classification; nothing is added to income or made available to convert`,
      reason: row.classification.kind === 'unclassified' ? row.classification.reasons.join('; ') : '',
    },
  };
}

/** STRCx 2025-11-30: issuer cash that the delivered shares cannot support. */
export function strcxImplausibleCash(rows: readonly RecordedTransition[]): SideBySide & { impliedPriceUsd: string; peerMedianUsd: string } {
  const row = find(rows, 'STRCx', '2025-11-30T23:55:00.000Z');
  const { before, after } = row.transition;
  const net = row.action?.netCashUsdPerShare ?? null;
  const sharesPerShare = Rational.fromFloat64(after).sub(Rational.fromFloat64(before)).div(Rational.fromFloat64(before));
  const warning = row.classification.kind === 'dividend' ? row.classification.warnings.join('; ') : '';
  const match = /reinvestment at \$([\d.]+)\/share against a median of \$([\d.]+)/.exec(warning);
  return {
    title: 'STRCx implausible issuer cash: $0.63 per share for 0.00000066 shares',
    symbol: row.symbol,
    activatedAt: row.transition.activatedAt.toISOString(),
    multiplierBefore: before,
    multiplierAfter: after,
    historyReason: row.historyReason,
    issuerAction: `${row.action?.type ?? 'none'} (${row.action?.eventId.slice(0, 8) ?? '—'}), net cash $${net ?? '—'} per share`,
    naive: {
      rule: "Value a dividend at the issuer's net cash",
      reading: `Books $${net} of income per share held, though only ${sharesPerShare.toFixed(8)} shares were delivered per share`,
    },
    corpact: {
      outcome:
        row.classification.kind === 'dividend' && row.classification.netCashUsdPerShare === null ? 'Dividend recognized — USD unknown' : row.classification.kind,
      reading: 'Keeps the delivered quantity as a verified dividend and counts it as unvalued; USD is null, never zero',
      reason: warning,
    },
    impliedPriceUsd: match?.[1] ?? '—',
    peerMedianUsd: match?.[2] ?? '—',
  };
}
