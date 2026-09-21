import { classifyTransition, sameF64, standingVersions } from '@corpact/accounting';
import { Rational, type Classification, type IssuerCorporateAction, type ObservedTransition } from '@corpact/domain';
import { createFixtureXStocksSource, type IssuerSource } from '@corpact/issuers';

/**
 * The recorded issuer data set (fixtures/xstocks/recorded-20260913) run through the classifier,
 * with the naive readings it replaces. Reads recorded files only: no network, no live issuer feed.
 */

export interface RecordedTransition {
  symbol: string;
  transition: ObservedTransition;
  /** The multiplier-history `reason` label - what a naive reader would trust. */
  historyReason: string;
  classification: Classification;
  /** The issuer corporate action whose multipliers match, if any. */
  action: IssuerCorporateAction | null;
}

export const RECORDING = 'fixtures/xstocks/recorded-20260913';

function matchingAction(t: ObservedTransition, actions: readonly IssuerCorporateAction[]): IssuerCorporateAction | null {
  return (
    standingVersions(actions.filter((a) => a.symbol === t.symbol)).find(
      (a) =>
        a.multiplierOld !== null &&
        a.multiplierNew !== null &&
        sameF64(Number(a.multiplierOld), t.before) &&
        sameF64(Number(a.multiplierNew), t.after),
    ) ?? null
  );
}

export async function loadRecorded(source: IssuerSource = createFixtureXStocksSource()): Promise<RecordedTransition[]> {
  // Both feeds, as the worker imports them: the upcoming feed carries announcements and cancellations (SCCOx).
  const history = await source.corporateActions('history');
  const upcoming = await source.corporateActions('upcoming');
  const rejected = [...history.rejected, ...upcoming.rejected];
  if (rejected.length > 0) throw new Error(`${rejected.length} recorded corporate actions failed validation`);
  const actions = [...history.actions, ...upcoming.actions];
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
  const distributions = rows.filter((r) => r.classification.kind === 'distribution');
  const unclassified = rows.filter((r) => r.classification.kind === 'unclassified');
  return {
    transitions: rows.length,
    assets: new Set(rows.map((r) => r.symbol)).size,
    dividends: {
      total: dividends.length,
      byOutcome: count(dividends, (r) => (r.classification.kind === 'dividend' ? dividendCategory(r.classification.warnings) : '')),
    },
    splits: { total: splits.length, byIssuerType: count(splits, (r) => r.action?.type ?? 'unknown') },
    /** Spin-offs delivered as value reinvested into the parent: basis allocations, never income. */
    distributions: { total: distributions.length, rows: distributions },
    /** Same position, new underlying listing (AZNx). */
    identityChanges: { total: rows.filter((r) => r.classification.kind === 'identity_change').length },
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
    issuerAction: `${row.action?.type ?? 'none'} (${row.action?.eventId.slice(0, 8) ?? '-'}), issuer cash figure $${cash ?? '-'} per share`,
    naive: {
      rule: 'Any multiplier increase is a dividend',
      reading: `Books ${gain} more shares as dividend income${cash ? `, worth the issuer's $${Number(cash).toFixed(2)} per share held` : ''}`,
    },
    corpact:
      row.classification.kind === 'distribution'
        ? {
            outcome: 'Spin-off - basis allocation, no income booked',
            reading: `Books the ${gain} unit change as principal bought with the distributed value (${percent(Rational.ONE.add(row.classification.distributedFraction), 2)} of the position); nothing is added to income or made available to convert`,
            reason: `Issuer SpinOff ${row.action?.eventId.slice(0, 8) ?? ''}; distributed share (M_new − M_old) ÷ M_new = ${row.classification.distributedFraction.toFixed(5)}, from the multipliers alone`,
          }
        : {
            outcome: row.classification.kind === 'unclassified' ? 'Unclassified adjustment - no income booked' : row.classification.kind,
            reading: `Shows the ${gain} unit change as pending classification; nothing is added to income or made available to convert`,
            reason: row.classification.kind === 'unclassified' ? row.classification.reasons.join('; ') : '',
          },
  };
}

const expectKind = <K extends Classification['kind']>(row: RecordedTransition, kind: K): Extract<Classification, { kind: K }> => {
  if (row.classification.kind !== kind) throw new Error(`${row.symbol} ${row.transition.activatedAt.toISOString()} is ${row.classification.kind}, expected ${kind}`);
  return row.classification as Extract<Classification, { kind: K }>;
};
const evidenceOf = (row: RecordedTransition) =>
  row.action ? `${row.action.type} (${row.action.eventId.slice(0, 8)} v${row.action.version}${row.action.notes ? `, note "${row.action.notes.trim()}"` : ''})` : 'none';
const gain = (row: RecordedTransition) => percent(exactRatio(row.transition.after, row.transition.before), 2);
const frame = (row: RecordedTransition) => ({
  symbol: row.symbol,
  activatedAt: row.transition.activatedAt.toISOString(),
  multiplierBefore: row.transition.before,
  multiplierAfter: row.transition.after,
  historyReason: row.historyReason,
  issuerAction: evidenceOf(row),
});

/** KRAQx 2026-03-26: rights sold and reinvested, published as a 1:1 UnitSplit. */
export function kraqxRights(rows: readonly RecordedTransition[]): SideBySide {
  const row = find(rows, 'KRAQx', '2026-03-26T23:55:00.000Z');
  const c = expectKind(row, 'distribution');
  return {
    title: `KRAQx rights sale labelled "UnitSplit": ${gain(row)} that is neither a split nor income`,
    ...frame(row),
    naive: {
      rule: "Trust the issuer's action type",
      reading: `Books a 1:1 unit split, which cannot explain a ${gain(row)} change: either rejects it, or rescales units with no basis allocated`,
    },
    corpact: {
      outcome: 'Rights distribution - basis allocation, no income booked',
      reading: `Books ${percent(Rational.ONE.add(c.distributedFraction), 2)} of the position's value as principal from rights sold and reinvested; nothing is added to income or made available to convert`,
      reason: c.warnings[0]!,
    },
  };
}

/** SCCOx 2026-08-12: a stock dividend announced, cancelled, rescheduled, delivered, and cancelled again as a schedule. */
export function sccoxChurn(rows: readonly RecordedTransition[]): SideBySide {
  const row = find(rows, 'SCCOx', '2026-08-12T00:30:00.000Z');
  const c = expectKind(row, 'split');
  return {
    title: 'SCCOx stock dividend with six issuer versions, the last one "Cancelled"',
    ...frame(row),
    naive: {
      rule: 'Take the latest issuer version',
      reading: `v6 is Cancelled, so the stock dividend reads as cancelled and the ${gain(row)} change goes unexplained, or is booked as income by size`,
    },
    corpact: {
      outcome: 'Stock dividend - quantity and basis adjustment, no income booked',
      reading: `Units ×${c.factor.toFixed(6)} on the delivered record (v5), cost basis spread across them; v6 cancels only the v4 schedule, and the lifecycle keeps all six revisions`,
      reason: c.warnings.join('; '),
    },
  };
}

/** LINx 2026-03-26: wrongly withheld tax passed back as a Corrected version of the 2026-03-11 dividend. */
export function linxWithholdingRefund(rows: readonly RecordedTransition[]): SideBySide {
  const refund = find(rows, 'LINx', '2026-03-26T23:55:00.000Z');
  const original = find(rows, 'LINx', '2026-03-11T00:15:00.000Z');
  const r = expectKind(refund, 'dividend');
  const o = expectKind(original, 'dividend');
  return {
    title: 'LINx withholding refund arriving as a new dividend',
    ...frame(refund),
    naive: {
      rule: 'Take the latest issuer version, and book cash with a multiplier increase as a dividend',
      reading: `The Corrected v${refund.action?.version} replaces v${original.action?.version}: the ${original.transition.activatedAt.toISOString().slice(0, 10)} dividend loses its evidence, and $${r.netCashUsdPerShare?.toTerminatingDecimal()} per share books as a new dividend`,
    },
    corpact: {
      outcome: 'Withholding refund - income, distinguishable from a new dividend',
      reading: `Keeps ${original.transition.activatedAt.toISOString().slice(0, 10)} as a cash dividend of $${o.netCashUsdPerShare?.toTerminatingDecimal()} net and books $${r.netCashUsdPerShare?.toTerminatingDecimal()} as a withholding_adjustment: ${o.netCashUsdPerShare?.toTerminatingDecimal()} + ${r.netCashUsdPerShare?.toTerminatingDecimal()} = ${original.action?.grossCashUsdPerShare} gross, withholding deducted once`,
      reason: `${r.warnings.join('; ')}. Issuer note: ${r.refundNote}`,
    },
  };
}

/** AZNx 2026-02-02: NASDAQ ADR → NYSE ordinary share, labelled "ReverseSplit". */
export function aznxIdentityChange(rows: readonly RecordedTransition[]): SideBySide {
  const row = find(rows, 'AZNx', '2026-02-02T22:00:00.000Z');
  const c = expectKind(row, 'identity_change');
  return {
    title: 'AZNx ADR conversion labelled "ReverseSplit"',
    ...frame(row),
    naive: {
      rule: 'Trust the multiplier-history label',
      reading: 'Books a 2:1 reverse split: the units are right, but the position silently becomes a different listing, with no lineage from the ADR it was',
    },
    corpact: {
      outcome: 'Identity change - basis carried over, lineage recorded, no income booked',
      reading: `${c.fromUnderlying} → ${c.toUnderlying}, units ×${c.factor.toFixed(1)}; all cost basis moves to the new identity, and the worker writes the lineage link`,
      reason: c.warnings[0]!,
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
    issuerAction: `${row.action?.type ?? 'none'} (${row.action?.eventId.slice(0, 8) ?? '-'}), net cash $${net ?? '-'} per share`,
    naive: {
      rule: "Value a dividend at the issuer's net cash",
      reading: `Books $${net} of income per share held, though only ${sharesPerShare.toFixed(8)} shares were delivered per share`,
    },
    corpact: {
      outcome:
        row.classification.kind === 'dividend' && row.classification.netCashUsdPerShare === null ? 'Dividend recognized - USD unknown' : row.classification.kind,
      reading: 'Keeps the delivered quantity as a verified dividend and counts it as unvalued; USD is null, never zero',
      reason: warning,
    },
    impliedPriceUsd: match?.[1] ?? '-',
    peerMedianUsd: match?.[2] ?? '-',
  };
}
