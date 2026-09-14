import { RECORDING, honxSpinOff, strcxImplausibleCash, type RecordedTransition, type SideBySide } from './recorded';

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

/** Part 2 of the demo: the two recorded cases a buyer cannot trivially rebuild. */
export function recordedCasesMarkdown(rows: readonly RecordedTransition[]): string {
  const honx = honxSpinOff(rows);
  const strcx = strcxImplausibleCash(rows);
  return [
    `## Part 2 — Two real cases the naive reading gets wrong (RECORDED issuer data)`,
    '',
    `> **Recorded, not synthetic, and not live.** These are xStocks corporate-action and multiplier-history responses recorded on 2026-09-13 (\`${RECORDING}\`), replayed offline through the production classifier.`,
    '',
    `### ${honx.title}`,
    '',
    sideBySideMarkdown(honx),
    '',
    `### ${strcx.title}`,
    '',
    sideBySideMarkdown(strcx),
    '',
    `The issuer's own numbers imply a reinvestment price of **$${Number(strcx.impliedPriceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}** per share (M_old × net cash ÷ (M_new − M_old)), against a median of **$${strcx.peerMedianUsd}** across STRCx's other dividends.`,
  ].join('\n');
}
