---
title: Classification from evidence
description: Why every multiplier change is matched to an issuer record, and what happens when it is not.
---

## The rule

A multiplier change is booked as income **only** when it matches a published issuer corporate action. A match needs all of these:

- the action's status is `Initial` or `Corrected` (the latest version of the event);
- its `multiplierOld` and `multiplierNew` equal the chain values (within 4ε);
- its effective time equals the on-chain activation **to the second**;
- exactly one action matches.

What happens next depends on the action type.

| Issuer action | Outcome |
|---|---|
| `CashDividend` | **Dividend.** The value comes from issuer net cash, when trustworthy |
| `ForwardSplit`, `ReverseSplit`, `UnitSplit` | **Split,** if the unit ratio reconciles with the multipliers |
| `SpinOff`, `StockDividend`, `StockMerger`, … | **Unclassified adjustment:** no income policy, not booked as income |
| No matching action | **Unclassified adjustment:** no published issuer action matches |

An unclassified adjustment is visible in income with its reason. It adds nothing to income and makes nothing available to convert.

## Why not trust the obvious signals

**The size of the change.** "Any increase is income" is wrong 24 times in the recorded data set. Some are splits of up to +900%, some are spin-offs (HONx: +95.11%), some are stock dividends, and 8 are changes the issuer never explained.

**The label.** The multiplier-history `reason` field says "Dividend" for spin-offs on GMEx, HONx, DFDVx and OPENx, and "ReverseSplit" for the AZNx merger. Across 654 changes, issuer evidence contradicts the label 14 times.

## Valuing a dividend

USD comes **only** from issuer evidence: shares held at the event × issuer net cash per share. It is never a market price.

| Situation | USD |
|---|---|
| Issuer publishes net cash | shares held × net cash |
| Only gross and withholding published | gross × (1 − withholding), with a warning |
| No issuer cash | `null`: the event is counted as unvalued |
| Cash implausible for the shares delivered | `null`, with a warning |

The last check compares the reinvestment price the issuer's numbers imply, `M_old × net ÷ (M_new − M_old)`, with the median across the same asset's other dividends. Outside a factor of 3, the issuer valuation is not used. STRCx 2025-11-30 implies **$953,728 per share** against a $94.80 median, so the dividend is kept and its USD is unknown.

> [!IMPORTANT] Unknown is not zero
> `usd: null` means Corpact has no trustworthy value. It is never summed as zero, and positions report `unvaluedDividendEvents` separately.

## Re-classification

Classification re-runs whenever issuer evidence changes: a late record, a correction, a cancelled action. A changed outcome **supersedes** the stored one, which is kept as evidence, and the ledger journals the difference. See [Corrections & the journal](/docs/concepts/corrections).
