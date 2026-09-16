---
title: Classification from evidence
description: Why every multiplier change is matched to an issuer record, and what happens when it is not.
---

## The rule

A multiplier change is booked **only** when it matches a published issuer corporate action. A match needs all of these:

- the version **stands**: it is `Initial` or `Corrected`, and no later cancellation names it. `Scheduled` announcements are never evidence. A cancellation voids only the version it names, so SCCOx's "[CANCELLED v4]" after delivery leaves the delivered v5 standing. A `Corrected` version delivered as a follow-on change, starting where the original ended, stands alongside the original (the LINx and NVOx withholding refunds);
- its `multiplierOld` and `multiplierNew` equal the chain values (within 4ε);
- its effective time equals the on-chain activation **to the second**;
- exactly one action matches.

Then the issuer's **evidence**, not its type label, decides the action type. Each type has its own page under [Corporate actions](/docs/actions) listing the evidence it needs.

| Evidence | Outcome |
|---|---|
| `CashDividend` | **Cash dividend:** income, valued from issuer net cash when trustworthy |
| `CashDividend` with zero gross, positive net and a note saying withholding was wrongly applied | **Withholding refund:** income, distinguishable from a new dividend |
| `ForwardSplit`, `ReverseSplit` whose unit ratio reconciles | **Split:** units rescaled, no income |
| `StockDividend`, delivered | **Stock dividend:** units rescaled, basis spread, no income |
| `SpinOff` | **Basis allocation:** (M_new − M_old) ÷ M_new of the position's value as principal, no income |
| `UnitSplit` 1:1 that cannot explain the change, with cash and a note naming warrants | **Rights distribution:** basis allocation, no income |
| `StockMerger` exchanging one listing of a company for another of the same company | **Identity change:** units rescaled, all basis carried over, lineage written |
| A type Corpact does not book automatically (mergers, redemptions, delistings, name changes) | **Unclassified adjustment,** shown with its reason and never booked |
| No matching action | **Unclassified adjustment:** no published issuer action matches |

An unclassified adjustment is visible with its reason. It adds nothing to income and makes nothing available to convert.

## Why not trust the obvious signals

**The size of the change.** "Any increase is a dividend" is wrong 22 times in the recorded data set. Some are splits of up to +900%, some are spin-offs (HONx: +95.11%), one is a stock dividend, one a rights sale, and 6 are changes the issuer never explained. The largest real dividend is +2.93%, and 4 of the 6 spin-offs fall below it.

**The label.** The multiplier-history `reason` field says "Dividend" for spin-offs on GMEx, HONx, DFDVx and OPENx and for SCCOx's stock dividend, and "ReverseSplit" for the AZNx ADR conversion. The issuer's own corporate-action type says `UnitSplit` for KRAQx's rights sale. Across 654 changes, issuer evidence contradicts the history label 12 times.

## Valuing a dividend

USD comes **only** from issuer evidence: shares held at the event × issuer net cash per share. It is never a market price.

| Situation | USD |
|---|---|
| Issuer publishes net cash | shares held × net cash |
| Only gross and withholding published | gross × (1 − withholding), with a warning |
| No issuer cash | `null`: the event is counted as unvalued |
| Cash implausible for the shares delivered | `null`, with a warning |

The last check compares the reinvestment price the issuer's numbers imply, `M_old × net ÷ (M_new − M_old)`, with the median across the same asset's other dividends. Outside a factor of 3, the issuer valuation is not used. STRCx implies **$953,728 per share** against a $94.80 median, so the dividend is kept and its USD is unknown.

> [!IMPORTANT] Unknown is not zero
> `usd: null` means Corpact has no trustworthy value. It is never summed as zero, and positions report `unvaluedDividendEvents` separately.

## Re-classification

Classification re-runs whenever issuer evidence changes: a late record, a correction, a cancelled action. A changed outcome **supersedes** the stored one, which is kept as evidence, and the ledger journals the difference. See [Corrections & the journal](/docs/concepts/corrections).
