import {
  RECORDING,
  aznxIdentityChange,
  honxSpinOff,
  kraqxRights,
  linxWithholdingRefund,
  sccoxChurn,
  strcxImplausibleCash,
  type RecordedTransition,
  type SideBySide,
} from './recorded';

export const table = (head: readonly string[], rows: ReadonlyArray<readonly (string | number)[]>) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

export function sideBySideMarkdown(c: SideBySide): string {
  return [
    table(
      ['', 'Naive reading', 'Corpact'],
      [
        ['Rule', c.naive.rule, 'Classify from issuer corporate-action evidence, never from the size or label of the change'],
        ['Result', `**${c.naive.reading}**`, `**${c.corpact.outcome}.** ${c.corpact.reading}`],
      ],
    ),
    '',
    `Evidence: multiplier ${c.multiplierBefore} → ${c.multiplierAfter} at ${c.activatedAt}; multiplier-history label "${c.historyReason}"; issuer record ${c.issuerAction}.`,
    '',
    `Stated reason: _${c.corpact.reason}_`,
  ].join('\n');
}

/** The recorded cases shown in Part 2, in the order they are presented. */
export const recordedCases = (rows: readonly RecordedTransition[]) => ({
  honx: honxSpinOff(rows),
  strcx: strcxImplausibleCash(rows),
  kraqx: kraqxRights(rows),
  sccox: sccoxChurn(rows),
  linx: linxWithholdingRefund(rows),
  aznx: aznxIdentityChange(rows),
});

/** Part 2 of the demo: real cases a buyer cannot trivially rebuild. */
export function recordedCasesMarkdown(rows: readonly RecordedTransition[]): string {
  const { honx, strcx, kraqx, sccox, linx, aznx } = recordedCases(rows);
  const section = (c: SideBySide) => [`### ${c.title}`, '', sideBySideMarkdown(c), ''];
  return [
    `## Part 2 - Six real cases the naive reading gets wrong (RECORDED issuer data)`,
    '',
    `> **Recorded, not synthetic, and not live.** These are xStocks corporate-action and multiplier-history responses recorded on 2026-09-13 (\`${RECORDING}\`), replayed offline through the production classifier.`,
    '',
    ...section(honx),
    ...section(strcx),
    `The issuer's own numbers imply a reinvestment price of **$${Number(strcx.impliedPriceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}** per share (M_old × net cash ÷ (M_new − M_old)), against a median of **$${strcx.peerMedianUsd}** across STRCx's other dividends.`,
    '',
    ...section(kraqx),
    ...section(sccox),
    ...section(linx),
    ...section(aznx),
  ].join('\n');
}
