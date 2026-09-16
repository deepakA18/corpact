import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ACTION_KINDS, ACTION_KIND_SPECS, type ActionKind, type ActionKindSpec } from '@corpact/domain';
import { REPO_ROOT } from './runner';

/**
 * One docs page per corporate-action type (apps/site/content/docs/actions). Status, treatment and real-instance
 * counts come from ACTION_KIND_SPECS, so a page cannot claim more than the code does; action-docs.test.ts fails
 * when the committed pages are stale. Regenerate with `pnpm --filter @corpact/demo action-docs`.
 */

interface ActionDoc {
  summary: string;
  detect: string;
  evidence: string[];
  missing: string[];
  booking: string;
  instances: string;
}

const NOT_BOOKED = 'Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert.';
const HELD_FOR_REVIEW = [
  'Always an unclassified adjustment with its reason: no income booked, conversion disabled.',
  'Corpact books this type automatically only once a real instance has occurred and been tested.',
];

const DOCS: Record<ActionKind, ActionDoc> = {
  cash_dividend: {
    summary: 'Cash paid on the underlying share and reinvested by the issuer through the multiplier.',
    detect: 'A multiplier increase that matches a standing `CashDividend` record exactly: both multipliers, and the activation time to the second.',
    evidence: [
      'A standing issuer version: `Initial` or `Corrected`, not cancelled. `Scheduled` announcements are never evidence.',
      "`multiplierOld` and `multiplierNew` equal the mint's f64 values, within 4ε.",
      "The record's effective time equals the on-chain activation.",
      'Exactly one record matches.',
    ],
    missing: [
      'No matching record: unclassified, "No published issuer action matches the observed multiplier change".',
      'Effective time differs from the activation: unclassified, with both times in the reason.',
      'More than one record matches: unclassified, naming the records.',
      'No usable net cash: still a dividend, with USD **null** (unknown, never zero).',
      'Net cash implying a reinvestment price outside ×3 of the median of the same asset\'s other dividends (STRCx: ~$953,728/share): still a dividend, with USD null and a warning.',
      'Gross × (1 − withholding) ≠ net: valued, with the inconsistency flagged.',
      "A 5% currency retention in the withholding field, with a note saying so (LINx, ETNx, ASMLx): recognised as `retentionRate`. It is not tax and is not deducted again.",
    ],
    booking: 'Units added are **income**. The protected floor is unchanged. USD = shares held at the event × issuer net cash per share.',
    instances: 'LINx, ETNx, ASMLx and TSMx cover the retention and retention-release cases; STRCx covers implausible issuer cash.',
  },
  withholding_adjustment: {
    summary: 'Tax withheld by mistake on an earlier dividend, passed back to holders.',
    detect:
      'A matching `CashDividend` version with zero gross cash, positive net cash, and an issuer note saying withholding tax was wrongly applied and is being passed back. The issuer publishes it as a `Corrected` version of the original dividend, delivered days later as a second multiplier change that starts where the first ended.',
    evidence: [
      'Everything a cash dividend needs: a standing record, exact multipliers, exact activation time.',
      'Gross cash zero or absent, net cash positive.',
      'A note naming withholding (WHT) and saying it was wrong, refunded, deducted or passed back.',
    ],
    missing: [
      'Without the note: an ordinary cash dividend, with its gross/withholding/net inconsistency flagged.',
      'Either way, the original dividend keeps its own evidence. A follow-on `Corrected` version never voids the version it follows.',
    ],
    booking:
      'Income, like the dividend it corrects, and distinguishable by type. Withholding is deducted once: LINx 1.12 + 0.48 = 1.60, and NVOx 0.2883412 + 0.1232128 = 0.411554, each equal to the original gross.',
    instances: 'LINx and NVOx, each refunding tax withheld on its preceding dividend.',
  },
  stock_dividend: {
    summary: 'New shares distributed to holders, delivered as a multiplier increase.',
    detect: 'A multiplier increase matching the delivered `StockDividend` record.',
    evidence: [
      'A standing (delivered) version matching both multipliers and the activation time.',
      'The multiplier increases.',
      'If the delivered record publishes a unit ratio, it must reconcile. Otherwise the factor is M_new ÷ M_old.',
    ],
    missing: [
      'Only announcements or cancellations: unclassified, since no delivered record matches.',
      'A published ratio that does not reconcile: unclassified, stating the ratio and both multipliers.',
      'A ratio stated by an earlier, superseded version is reported as a warning and never used.',
    ],
    booking: 'Units ×factor, with cost basis spread across them. The protected floor scales by the same factor. Zero income; nothing newly convertible.',
    instances:
      'SCCOx. The issuer published six versions across two feeds: scheduled at 1:1.012, cancelled ("Will be a cash flow, not a unit change"), cancelled again, rescheduled, delivered at ×1.0153, then the schedule was cancelled after delivery. The lifecycle keeps all six, each naming the revision it supersedes.',
  },
  cash_and_stock_dividend: {
    summary: 'A dividend paid partly in cash and partly in shares.',
    detect: 'A matching `CashAndStockDividend` record is recognised, and never booked.',
    evidence: ['A standing record matching both multipliers and the activation time.'],
    missing: HELD_FOR_REVIEW,
    booking: `${NOT_BOOKED} Splitting one multiplier change into income and a stock dividend needs an issuer unit ratio or a price, and neither has a real instance.`,
    instances: 'None. The type exists in the issuer enum and has never been used.',
  },
  forward_split: {
    summary: 'More shares per share; each is worth proportionally less.',
    detect: 'A multiplier change matching a standing `ForwardSplit` record whose unit ratio reconciles with the multipliers.',
    evidence: ['A standing record matching both multipliers and the activation time.', 'M_old × (toUnits ÷ fromUnits) equals M_new within 4ε. With no published ratio, the factor is derived and a warning says so.'],
    missing: ['A ratio that does not reconcile: unclassified.', 'A split record publishing cash: recognised as fractional cash in lieu, and not booked.'],
    booking: 'Units ×factor. The protected floor ×factor. Zero income.',
    instances: 'NFLXx 10:1, VUGx 6:1, KLACx 10:1, CRWDx 4:1 and others, each reconciled to the issuer unit ratio.',
  },
  reverse_split: {
    summary: 'Fewer shares per share; each is worth proportionally more.',
    detect: 'A multiplier decrease matching a standing `ReverseSplit` record whose unit ratio reconciles.',
    evidence: ['A standing record matching both multipliers and the activation time.', 'The unit ratio reconciles with the multipliers.'],
    missing: [
      'A ratio that does not reconcile: unclassified.',
      'The same ratio is not enough on its own. AZNx halved its multiplier exactly like HONx did, and was an identity change; the issuer record decides.',
    ],
    booking: 'Units ×factor. The protected floor ×factor. Zero income.',
    instances: 'HONx, 2:1.',
  },
  unit_split: {
    summary: "A change in the number of wrapper units per underlying share, as the issuer's enum defines it.",
    detect: 'A reconciling `UnitSplit` record is recognised and not booked. A 1:1 `UnitSplit` with issuer cash and a note naming warrants or rights is a rights distribution.',
    evidence: ['A standing record matching both multipliers and the activation time.', 'The unit ratio reconciles.'],
    missing: ['Ratio does not reconcile: unclassified.', ...HELD_FOR_REVIEW.slice(0, 1)],
    booking: NOT_BOOKED,
    instances: 'None. The only `UnitSplit`-labelled record, on KRAQx, was a rights sale.',
  },
  cash_in_lieu: {
    summary: 'Cash paid for a fractional share left over by a split.',
    detect: 'A split record that publishes cash is recognised as cash in lieu, and not booked.',
    evidence: ['A split record that reconciles and publishes non-zero gross or net cash.'],
    missing: HELD_FOR_REVIEW,
    booking: `${NOT_BOOKED} A Scaled UI split rescales the multiplier, so raw token amounts never become fractional. This path is structurally unlikely, not merely unobserved.`,
    instances: 'None.',
  },
  spin_off: {
    summary: "Shares of a separated company distributed to the parent's holders.",
    detect: 'A multiplier increase matching a standing `SpinOff` record. xStocks never deliver the new company\'s shares: they sell them and reinvest the proceeds into the parent.',
    evidence: [
      'A standing record matching both multipliers and the activation time.',
      'The multiplier increases.',
      'Issuer proceeds, when published, must imply a parent price within ×3 of the median implied by the same asset\'s dividends.',
    ],
    missing: [
      'The multiplier does not increase: unclassified. Only distributions reinvested into the parent are supported.',
      'No proceeds published: booked from the multipliers alone, with a warning.',
      'Implausible proceeds: booked, with proceeds null and a warning.',
    ],
    booking:
      "**Basis allocation.** The distributed share of the position's value is exactly (M_new − M_old) ÷ M_new, with no price needed. The added units are principal carrying allocated basis. The floor scales with the multiplier. Zero income; nothing newly convertible.",
    instances:
      'GMEx, HONx ×2, DFDVx, OPENx and CMCSAx. Four are labelled "Dividend" and two "Administrative"; four of the six raise the multiplier less than the largest cash dividend (+2.93%).',
  },
  rights_distribution: {
    summary: 'Subscription rights or warrants distributed to holders.',
    detect:
      'Sold rights: a `UnitSplit` record whose 1:1 ratio cannot explain a multiplier increase, with positive issuer cash and a note naming warrants or rights. A record labelled `RightsDistribution` is recognised and not booked, because its delivery has never been observed.',
    evidence: [
      'A standing record matching both multipliers and the activation time.',
      'A 1:1 unit ratio, a multiplier increase, and positive issuer cash.',
      'An issuer note naming warrants or rights.',
    ],
    missing: [
      'Without the note: an unclassified unit split, "factor 1:1 does not reconcile".',
      'A `RightsDistribution` label: recognised, and not booked.',
      'Exercised or lapsed rights: not booked.',
    ],
    booking:
      "**Basis allocation**, as for a spin-off: (M_new − M_old) ÷ M_new of the position's value as principal. Issuer proceeds are recorded when published, and never booked as income.",
    instances:
      'KRAQx: 18,606 warrants sold at $0.5553 less a $100 subscription fee, reinvested at $0.1356647/share. Three versions; v2 cancelled v1 for the fee miscalculation, and only v3 matches the chain.',
  },
  stock_merger: {
    summary: 'The underlying company is acquired for shares of another company.',
    detect:
      'A matching `StockMerger` record is recognised and not booked, unless its note exchanges one listing of a company for another listing of the *same* company. That is an identity change.',
    evidence: ['A standing record matching both multipliers and the activation time.'],
    missing: ['A note naming a different company: recognised as a stock-for-stock merger, and not booked.', ...HELD_FOR_REVIEW],
    booking: `${NOT_BOOKED} The lineage model supports a \`transform\` link, and its basis conservation is property-tested, but nothing writes one.`,
    instances: 'None. The only `StockMerger` record, AZNx, is a listing conversion.',
  },
  cash_merger: {
    summary: 'The underlying company is acquired for cash.',
    detect: 'A matching `CashMerger` record is recognised and not booked.',
    evidence: ['A standing record matching both multipliers and the activation time.'],
    missing: HELD_FOR_REVIEW,
    booking: `${NOT_BOOKED} How xStocks would deliver cash for a delisted underlying (multiplier to zero, burn, off-chain redemption) is unknown.`,
    instances: 'None.',
  },
  mixed_merger: {
    summary: 'The underlying company is acquired for shares and cash.',
    detect: 'A matching `StockAndCashMerger` record is recognised and not booked.',
    evidence: ['A standing record matching both multipliers and the activation time.'],
    missing: HELD_FOR_REVIEW,
    booking: NOT_BOOKED,
    instances: 'None.',
  },
  identity_change: {
    summary: 'The same economic position under a new underlying listing or form.',
    detect:
      "A matching `StockMerger` record whose note exchanges one listing of a company for another listing of the same company, at a ratio that reconciles exactly. For example: \"Stock Merger 0.5 NYSE:AZN for 1 NASDAQ:AZN (ADR)\". A `NameChange` record is recognised and not booked: a rename has no real instance.",
    evidence: [
      'A standing record matching both multipliers and the activation time.',
      'An issuer note in the form `Stock Merger <qty> <venue>:<ticker> for <qty> <venue>:<ticker>`, with the same ticker on both sides.',
      'The note ratio equals the published unit ratio, and M_old × ratio equals M_new within 4ε.',
    ],
    missing: [
      'No note, or a note naming a different company: recognised as a stock merger, and not booked.',
      'A ratio that does not reconcile: unclassified.',
      '`NameChange`: recognised, and not booked.',
    ],
    booking:
      'Units ×ratio, all cost basis carried over; the protected floor scales by the ratio. Zero income. The worker writes the position lineage: the identity held before, the identity after, and a link whose successor carries exactly all basis. `GET /v2/instruments/{mint}/lineage` traces it.',
    instances: 'AZNx: NASDAQ ADR → NYSE ordinary share, 2:1. Labelled `StockMerger` by the issuer and "ReverseSplit" by multiplier history.',
  },
  redemption: {
    summary: 'The wrapper is redeemed or discontinued and holders are paid out.',
    detect: 'A matching `Redemption` record is recognised and not booked.',
    evidence: ['A standing record matching both multipliers and the activation time.'],
    missing: HELD_FOR_REVIEW,
    booking: `${NOT_BOOKED} The lineage model has a \`terminate\` link (all basis leaves as cash), but nothing writes one.`,
    instances: 'None. No record uses `Redemption` or `redemptionPriceUsd`. Four assets are marked halted, and none has terminated.',
  },
  delisting: {
    summary: 'The underlying is delisted or declared worthless.',
    detect: 'A matching `WorthlessRemoval` record is recognised and not booked.',
    evidence: ['A standing record matching both multipliers and the activation time.'],
    missing: HELD_FOR_REVIEW,
    booking: NOT_BOOKED,
    instances: 'None.',
  },
  seizure: {
    summary: "Tokens moved out of a holder's account by the mint's permanent delegate.",
    detect: 'Not detected as its own type yet (ADR-0006). See how it is booked below.',
    evidence: ["Would need: the signing authority of each token movement, to tell the holder from the delegate. Wallet history ingestion does not record it today."],
    missing: [
      "Today a delegate transfer out of a tracked wallet is booked as a **withdrawal**: the protected floor scales down proportionally, income is unaffected, and the position still reconciles. It is **not** flagged as a seizure.",
    ],
    booking: 'Not booked as its own type.',
    instances: 'None on xStocks. One delegate key is permanent delegate on all 832 mints, and its full history (1,685 transactions) contains no transfer or burn out of another owner.',
  },
  unknown: {
    summary: 'A multiplier change no published issuer record explains, or a record of type `Unknown`.',
    detect: 'Any activated multiplier change that no other type claims.',
    evidence: ['None matched.'],
    missing: ['Always an unclassified adjustment, with the reason.'],
    booking: NOT_BOOKED,
    instances: 'Six recorded changes have no issuer record: STRCx ×2, SATAx, TQQQx, CMCSAx and JPMx.',
  },
};

/**
 * Only types Corpact books get a page. A type it recognises but holds for review is still returned by the API,
 * and is covered by one line on the index rather than a page that would read as an unfinished feature.
 */
const PUBLISHED = ACTION_KINDS.filter((kind) => ACTION_KIND_SPECS[kind].classifier === 'validated');

const TREATMENT_TEXT: Record<ActionKindSpec['treatment'], string> = {
  income: 'Income',
  quantity_basis: 'Quantity and basis adjustment',
  basis_allocation: 'Basis allocation',
  identity: 'Identity change',
  termination: 'Termination',
  custody_transfer: 'Custody transfer',
  not_booked: 'Not booked',
};

/** What API v1 shows for this type, which predates the taxonomy. */
function v1Presentation(kind: ActionKind): string {
  if (kind === 'cash_dividend' || kind === 'withholding_adjustment') return '`dividend`';
  if (kind === 'forward_split' || kind === 'reverse_split') return '`split`';
  if (kind === 'stock_dividend' || kind === 'spin_off' || kind === 'rights_distribution' || kind === 'identity_change') {
    return '`unclassified_adjustment`, with the treatment stated in `reasons` and `headline`';
  }
  return '`unclassified_adjustment`';
}

export const actionSlug = (kind: ActionKind) => kind.replaceAll('_', '-');
const bullets = (items: readonly string[]) => items.map((i) => `- ${i}`).join('\n');

function renderPage(kind: ActionKind): string {
  const spec = ACTION_KIND_SPECS[kind];
  const doc = DOCS[kind];
  return `---
title: ${JSON.stringify(spec.label)}
description: ${JSON.stringify(doc.summary)}
---

| Detail | Value |
|---|---|
| Type | \`${kind}\` |
| Category | ${spec.category} |
| Ledger treatment | ${TREATMENT_TEXT[spec.treatment]} |

## What we detect

${doc.detect}

## Evidence required

${bullets(doc.evidence)}

## When evidence is missing or conflicts

${bullets(doc.missing)}

## How it is booked

${doc.booking}

## In practice

${doc.instances}

## In the API

- **v2:** \`type: "${kind}"\`, \`treatment: "${spec.treatment === 'termination' || spec.treatment === 'custody_transfer' ? 'not_booked' : spec.treatment}"\`, with \`validation\`, the lifecycle and the evidence on \`GET /v2/actions/{id}\`.
- **v1:** shown as ${v1Presentation(kind)}.
`;
}

function renderIndex(): string {
  const rows = PUBLISHED.map((kind) => {
    const spec = ACTION_KIND_SPECS[kind];
    return `| [${spec.label}](/docs/actions/${actionSlug(kind)}) | \`${kind}\` | ${TREATMENT_TEXT[spec.treatment]} |`;
  });
  return `---
title: Corporate actions
description: The corporate-action types Corpact books, the evidence each one needs, and how it reaches the ledger.
---

Every multiplier change is classified from issuer evidence only: never from the size of the change or its label. These are the types Corpact books, each validated against real recorded data.

| Action | Type | Ledger treatment |
|---|---|---|
${rows.join('\n')}

Other types the issuer can publish, such as mergers and redemptions, are recognised and shown with their reason, and are never booked automatically. No number reaches your ledger from an action type Corpact has not proven on real data.

## Lifecycle

Each action moves through \`announced → confirmed → activated\`, and may end \`corrected\`, \`reversed\` or \`superseded\`. The history is append-only. Every issuer revision before activation is kept as its own step, naming the revision it supersedes, so a type that churned before delivery (SCCOx) keeps all of it.
`;
}

/** Relative path under the repository → file content. */
export function renderActionDocs(): Map<string, string> {
  const files = new Map<string, string>();
  // The docs loader maps the slug `actions` to content/docs/actions.md.
  files.set('apps/site/content/docs/actions.md', renderIndex());
  for (const kind of PUBLISHED) files.set(`apps/site/content/docs/actions/${actionSlug(kind)}.md`, renderPage(kind));
  const nav = PUBLISHED.map((kind) => `  { title: '${ACTION_KIND_SPECS[kind].label.replaceAll("'", "\\'")}', slug: 'actions/${actionSlug(kind)}' },`);
  files.set(
    'apps/site/lib/actions-nav.generated.ts',
    `// Generated by \`pnpm --filter @corpact/demo action-docs\` from ACTION_KIND_SPECS. Do not edit.\nimport type { NavItem } from './nav';\n\nexport const ACTION_NAV: NavItem[] = [\n  { title: 'All action types', slug: 'actions' },\n${nav.join('\n')}\n];\n`,
  );
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  for (const [path, content] of renderActionDocs()) {
    mkdirSync(dirname(join(REPO_ROOT, path)), { recursive: true });
    writeFileSync(join(REPO_ROOT, path), content);
  }
  console.log(`Wrote ${PUBLISHED.length} action pages, the index and the nav`);
}
