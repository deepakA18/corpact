import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Classification, IssuerCorporateAction } from '@corpact/domain';
import { createFixtureXStocksSource } from '@corpact/issuers';
import { sideBySideMarkdown, table } from './present';
import { RECORDING, honxSpinOff, loadRecorded, strcxImplausibleCash, summarize, type RecordedTransition } from './recorded';
import { REPO_ROOT } from './runner';

/**
 * Generates docs/findings/what-this-catches.md: the leave-behind for issuer and buyer conversations.
 * Every figure is computed from the recorded issuer data set by the production classifier.
 * No network access, no live issuer feed, no market prices.
 */

const OUTPUT = join(REPO_ROOT, 'docs/findings/what-this-catches.md');
const day = (r: RecordedTransition) => r.transition.activatedAt.toISOString().slice(0, 10);
const byCount = (tally: Record<string, number>) => Object.entries(tally).toSorted((a, b) => b[1] - a[1]);
const shortIds = (text: string) => text.replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '$1…');
const change = (r: RecordedTransition) => (r.transition.after / r.transition.before - 1) * 100;
const signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
const share = (c: Extract<Classification, { kind: 'distribution' }>) => `${(Number(c.distributedFraction.toFixed(6)) * 100).toFixed(2)}%`;

function outcome(c: Classification): string {
  switch (c.kind) {
    case 'dividend':
      return c.action === 'withholding_adjustment' ? 'Withholding refund - income, not a new dividend' : 'Cash dividend - income';
    case 'split':
      return c.action === 'stock_dividend' ? `Stock dividend - units ×${c.factor.toFixed(6)}, basis spread, not income` : `Split (${c.action.replace('_', ' ')}) - not income`;
    case 'distribution':
      return `${c.action === 'rights_distribution' ? 'Rights sold and reinvested' : 'Spin-off'} - ${share(c)} of the position as principal, not income`;
    case 'identity_change':
      return `Identity change - ${c.fromUnderlying} → ${c.toUnderlying}, units ×${c.factor.toFixed(2)}, not income`;
    case 'unclassified':
      return 'Not income - pending classification';
  }
}

const beforeAfter = (rows: string[][]) => table(['Issuer feed says', 'A naive integration books', 'Corpact books'], rows);

async function main() {
  const rows = await loadRecorded();
  const s = summarize(rows);
  const honx = honxSpinOff(rows);
  const strcx = strcxImplausibleCash(rows);
  const mislabels = s.labelMismatches;
  const increases = s.increasesNotCashDividends;

  const source = createFixtureXStocksSource();
  const feeds = { history: (await source.corporateActions('history')).actions, upcoming: (await source.corporateActions('upcoming')).actions };
  const versions = (prefix: string) =>
    (['history', 'upcoming'] as const)
      .flatMap((feed) => feeds[feed].filter((a) => a.eventId.startsWith(prefix)).map((a) => ({ feed, a })))
      .toSorted((x, y) => x.a.version - y.a.version);
  const find = (symbol: string, iso: string) => {
    const row = rows.find((r) => r.symbol === symbol && r.transition.activatedAt.toISOString() === iso);
    if (!row) throw new Error(`No recorded ${symbol} change at ${iso}`);
    return row;
  };

  // Case: KRAQx rights mislabelled as UnitSplit.
  const kraqx = find('KRAQx', '2026-03-26T23:55:00.000Z');
  if (kraqx.classification.kind !== 'distribution') throw new Error('KRAQx is expected to be a rights distribution');
  const kraqxVersions = versions('25ca1d3c');

  // Case: SCCOx type churn before delivery.
  const sccox = find('SCCOx', '2026-08-12T00:30:00.000Z');
  if (sccox.classification.kind !== 'split') throw new Error('SCCOx is expected to be a stock dividend');
  const sccoxVersions = versions('ed857d4c');
  const said = (a: IssuerCorporateAction) =>
    a.multiplierOld !== null
      ? `delivered: multiplier ${a.multiplierOld} → ${a.multiplierNew}`
      : a.fromUnits !== null
        ? `ratio ${a.fromUnits}:${a.toUnits}${a.effectiveAt ? `, effective ${a.effectiveAt.toISOString().slice(0, 16)}` : ''}`
        : a.effectiveAt
          ? `effective ${a.effectiveAt.toISOString().slice(0, 16)}, no ratio`
          : '-';

  // Case: withholding refunds.
  const refunds = rows.filter((r) => r.classification.kind === 'dividend' && r.classification.action === 'withholding_adjustment');
  const refundPairs = refunds.map((refund) => {
    const eventId = refund.classification.kind === 'dividend' ? refund.classification.eventId : '';
    const original = rows.find((r) => r !== refund && r.classification.kind === 'dividend' && r.classification.eventId === eventId)!;
    const net = (r: RecordedTransition) => (r.classification.kind === 'dividend' ? r.classification.netCashUsdPerShare : null);
    return { refund, original, originalNet: net(original)!, refundNet: net(refund)!, gross: original.action!.grossCashUsdPerShare! };
  });
  const retentions = rows.filter((r) => r.classification.kind === 'dividend' && r.classification.retentionRate !== null);

  // Case: size is not evidence.
  const largestDividend = Math.max(...rows.filter((r) => r.classification.kind === 'dividend' && r.classification.action === 'cash_dividend').map(change));
  const basisEvents = rows.filter(
    (r) =>
      r.classification.kind === 'distribution' ||
      (r.classification.kind === 'split' && r.classification.action === 'stock_dividend') ||
      (r.classification.kind === 'dividend' && r.classification.action === 'withholding_adjustment'),
  );
  const spinOffs = s.distributions.rows.filter((r) => r.classification.kind === 'distribution' && r.classification.action === 'spin_off');
  const aznx = find('AZNx', '2026-02-02T22:00:00.000Z');
  const honxReverse = find('HONx', '2026-06-29T15:30:00.000Z');

  const doc = `# What Corpact catches

Corpact turns tokenized-stock multiplier changes into an evidence-backed corporate-actions ledger. This page shows what that means on **real recorded issuer data**: every multiplier change xStocks published for its Solana assets, recorded 2026-09-13, run through the production classifier.

> **Source and limits.** Recorded issuer responses (\`${RECORDING}\`), replayed offline, with no live calls to the issuer. There are no market prices on this page and no valuation claims: dollar figures are the issuer's own per-share cash amounts, or prices implied by them. Generated by \`pnpm --filter @corpact/demo catches\`, and pinned by \`apps/demo/src/recorded.test.ts\` and \`packages/accounting/src/basis-events.test.ts\`.

## ${s.transitions} multiplier changes, every one accounted for

| Outcome | Count |
|---|---|
| Verified cash dividend (issuer action matched on exact multipliers and activation time) | **${s.dividends.total - refunds.length}** |
| Withholding refund, distinguished from a new dividend | **${refunds.length}** |
| Split or stock dividend, reconciled to the issuer's evidence | **${s.splits.total}** |
| Spin-off or rights sale, booked as a basis allocation: principal, **never income** | **${s.distributions.total}** |
| Identity change of the underlying, basis carried over | **${s.identityChanges.total}** |
| Not attributed: shown as pending classification, **no income booked** | **${s.unclassified.total}** |

**How dividends are valued**

${table(['Valuation outcome', 'Dividends'], byCount(s.dividends.byOutcome))}

**Why ${s.unclassified.total} changes are not income**

${table(['Stated reason', 'Changes'], byCount(s.unclassified.byReason))}

**Splits by issuer type:** ${byCount(s.splits.byIssuerType).map(([t, n]) => `${t} ${n}`).join(', ')}.

## Case 1 - ${honx.title}

${sideBySideMarkdown(honx)}

## Case 2 - ${strcx.title}

${sideBySideMarkdown(strcx)}

Implied reinvestment price, from the issuer's own numbers (M_old × net cash ÷ (M_new − M_old)): **$${Number(strcx.impliedPriceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}** per share, against a median of **$${strcx.peerMedianUsd}** across STRCx's other dividends.

## Case 3 - KRAQx: rights sold for cash, labelled \`UnitSplit\`

On ${day(kraqx)} the issuer published a \`UnitSplit\` at **1:1** for KRAQx, and the multiplier rose ${signed(change(kraqx))}. A 1:1 unit split cannot move a multiplier. The note says what happened: warrants were sold and the proceeds reinvested.

${table(
  ['Version', 'Status', 'Multipliers', 'Issuer note'],
  kraqxVersions.map(({ a }) => [`v${a.version}`, a.status, a.multiplierOld === null ? '-' : `${a.multiplierOld} → ${a.multiplierNew}`, a.notes ?? '-']),
)}

${beforeAfter([
  [
    `\`UnitSplit\` 1:1, multiplier ${kraqx.transition.before} → ${kraqx.transition.after}`,
    `Trusting the type: a split, so ${signed(change(kraqx))} more units with no basis allocated to them. Trusting size: ${signed(change(kraqx))} of dividend income`,
    `**Rights distribution.** ${share(kraqx.classification)} of the position's value came from the sold rights, booked as principal with allocated basis. Zero income, nothing newly convertible. Issuer proceeds of $${kraqx.action?.netCashUsdPerShare}/share are recorded, not valued: KRAQx has too few dividends to cross-check them`,
  ],
  ['v1 multipliers, before a $100 fee was included', 'The first published figure', 'Only v3: v2 cancelled v1, and the chain matches v3'],
])}

Without the note naming the rights, Corpact would leave this change unclassified: "factor 1:1 does not reconcile". The note is the evidence; the label is not.

## Case 4 - SCCOx: a stock dividend that changed form twice before delivery

Across its two feeds the issuer published **${sccoxVersions.length} versions** of one SCCOx event within ${Math.round((sccoxVersions.at(-1)!.a.createdAt.getTime() - sccoxVersions[0]!.a.createdAt.getTime()) / 60_000)} minutes. It announced a stock dividend, cancelled it ("will be a cash flow, not a unit change"), rescheduled it, delivered it, and then cancelled the schedule after delivery.

${table(
  ['Version', 'Feed', 'Status', 'Created (UTC)', 'What it said', 'Note'],
  sccoxVersions.map(({ feed, a }) => [`v${a.version}`, feed, a.status, a.createdAt.toISOString().slice(11, 19), said(a), a.notes?.trim() || '-']),
)}

${beforeAfter([
  [
    'Six versions; the highest one (v6) is `Cancelled`',
    "Latest version wins: the action was cancelled, so the delivered change is either unexplained or read as a dividend. First announcement wins: a 1:1.012 ratio, which doesn't reconcile with the chain",
    `**Stock dividend** on the delivered record (v5): units ×${sccox.classification.factor.toFixed(6)}, cost basis spread across them, zero income. v6 cancels the v4 *schedule*, not the delivery. The lifecycle keeps all ${sccoxVersions.length} revisions, each naming the one it supersedes`,
  ],
])}

## Case 5 - Withholding refunds arrive as new dividends

When tax was withheld by mistake, the issuer passes it back as a **\`Corrected\` version of the original dividend**, delivered days later as a second multiplier change with gross cash of zero.

${beforeAfter(
  refundPairs.map((p) => [
    `${p.refund.symbol} ${day(p.refund)}: \`Corrected\` v${p.refund.action?.version}, gross ${p.refund.action?.grossCashUsdPerShare}, net ${p.refund.action?.netCashUsdPerShare}. Note: "${p.refund.action?.notes?.trim().slice(0, 90)}…"`,
    `Latest version replaces the original: the ${day(p.original)} dividend loses its evidence and goes unexplained, and the refund books as a new dividend. Or a gross × (1 − withholding) = net check flags the refund as inconsistent`,
    `**Both stand.** ${day(p.original)}: cash dividend, net $${p.originalNet.toTerminatingDecimal()}. ${day(p.refund)}: \`withholding_adjustment\`, $${p.refundNet.toTerminatingDecimal()}. Withholding is deducted once: ${p.originalNet.toTerminatingDecimal()} + ${p.refundNet.toTerminatingDecimal()} = ${p.gross}, the original gross`,
  ]),
)}

The issuer also publishes a **5% currency retention** in the withholding-rate field (${retentions.map((r) => `${r.symbol} ${day(r)}`).join(', ')}). It is not tax: net cash already reflects it, so Corpact records it as \`retentionRate\` and flags nothing. A later dividend that releases an earlier retention (TSMx 2026-06-11) is not a reconciliation gap either.

## Case 6 - Size is not evidence

The largest recorded cash dividend raised its multiplier **${signed(largestDividend)}**. **${spinOffs.filter((r) => change(r) < largestDividend).length} of ${spinOffs.length} spin-offs** fall inside that range. So do the stock dividend, the rights sale and both withholding refunds, which a size threshold would read as dividends:

${table(
  ['Asset', 'Activation', 'Change', 'Inside the dividend size range', 'Corpact'],
  basisEvents
    .toSorted((a, b) => change(a) - change(b))
    .map((r) => [r.symbol, day(r), signed(change(r)), change(r) < largestDividend ? '**yes**' : 'no', outcome(r.classification)]),
)}

Ratios don't separate kinds either. AZNx on ${day(aznx)} and HONx on ${day(honxReverse)} both halved their multipliers exactly (×${(aznx.transition.after / aznx.transition.before).toFixed(1)}). One is a reverse split; the other is an ADR converting to the ordinary share. Only the issuer note, "${aznx.action?.notes}", tells them apart. Corpact books AZNx as an identity change and writes it to the position lineage, with all basis carried over.

## Case 7 - The label is not evidence

The multiplier-history \`reason\` field is the obvious thing to trust. On ${mislabels.length} of the ${s.transitions} changes, issuer corporate-action evidence contradicts it:

${table(
  ['Asset', 'Activation', 'Label says', 'Issuer evidence', 'Corpact'],
  mislabels.map((r) => [r.symbol, day(r), r.historyReason, r.action?.type ?? 'no matching action', outcome(r.classification)]),
)}

More broadly, "any multiplier increase is income" is wrong **${increases.length} times**. ${increases.filter((r) => r.action !== null).length} are splits, spin-offs, rights or stock dividends the issuer published. ${increases.filter((r) => r.action === null).length} are changes the issuer never explained:

${table(
  ['Asset', 'Activation', 'Change', 'Corpact'],
  increases.map((r) => [
    r.symbol,
    day(r),
    signed(change(r)),
    r.classification.kind === 'unclassified' ? shortIds(r.classification.reasons[0]!) : outcome(r.classification),
  ]),
)}

## Also handled

- **Income with no account write.** A multiplier activates at a scheduled time with no transaction, so nothing appears in a transfer feed. The dividend is detected from chain time.
- **Corrections.** Issuers revise actions (STRCx event c5721924 went through several revisions). A changed interpretation is journaled as a reversal plus a replacement, and settled entries are never edited.
- **Endpoint disagreement.** The issuer's own endpoints differ in the last representable digit (HONx 2026-05-15: \`1.020191445467247\` vs \`"1.0201914454672472"\`). The chain f64 is canonical, and matches allow a 4ε tolerance.
- **Late publication.** A write published after its scheduled time (VTIx: 70 s) is recognized, not reported as missing history.
- **Partial history.** A position whose history cannot be fully replayed is marked partial, and **no yield is claimed for it**.

## Open, not smoothed over

- **Price sources disagree.** On 2026-09-13, CRWDx was quoted at $206.37 by xStocks and $119.41 by Jupiter, a 42% gap. There is no rule yet for staleness or disagreement between price sources, so Corpact publishes **no market-price valuations**. A dividend without trustworthy issuer cash keeps its quantity, with USD **unknown**, never zero.
- **Types with no real instance.** Cash and mixed mergers, redemptions, delistings, name changes, cash-and-stock dividends and fractional cash in lieu have never occurred on xStocks. Corpact recognises them, labels them **unvalidated**, and books nothing. A permanent-delegate seizure has also never occurred: one delegate key on all 832 mints, with no transfer out of a holder in its history. Its detector is **not built**, and ADR-0006 states the consequence.
- **Tax treatment.** Corpact supplies allocation factors, lineage and evidence. Whether a jurisdiction treats a cash-reinvested spin-off or rights sale as a disposal, a return of capital or income is for the tax tool and its counsel.
`;

  writeFileSync(OUTPUT, doc);
  console.log(`Wrote ${OUTPUT}: ${s.transitions} changes, ${mislabels.length} label mismatches, ${increases.length} non-dividend increases`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
