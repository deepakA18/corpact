# ADR-0001: Classify multiplier changes from issuer corporate actions, not the multiplier-history reason

**Status:** Accepted · **Date:** 2026-09-13 · **Evidence:** [phase0-validation.md](../findings/phase0-validation.md) §4

## Context

A Scaled UI multiplier increase is produced by dividends, splits, spin-offs and mergers alike. PLAN §5 requires classification by evidence, never by size.

xStocks publishes two candidate sources:

- `/assets/{symbol}/multiplier/history` has a free-text `reason` per change.
- `/corporate-actions/history` has a typed `caType`, versioned records with `Corrected`/`Cancelled` status, exact multipliers, and per-share gross/net cash.

Tested against all 654 recorded transitions, `reason` disagrees with the typed corporate action where it matters. It labels four spin-offs as `Dividend` (GMEx, DFDVx, OPENx, and HONx on 2025-10-30), so a reader trusting `reason` books them as income. It also labels a stock merger `ReverseSplit` (AZNx).

A separate, larger risk comes from a reader that treats every multiplier increase as a dividend. The HONx spin-off on 2026-06-29 moved the multiplier from 0.512 to 0.999, which that reader would book as ~95% of the position in income. `reason` labels that one `Administrative`, so a `reason`-trusting reader would *not* be fooled by it. Neither shortcut is safe; the typed corporate action is the only source that gets both right.

## Decision

1. A transition is classified only by matching it to the **latest version** of a corporate action that is `Initial` or `Corrected`. The action's `multiplierOld`/`multiplierNew` must equal the on-chain f64 values within 4ε relative, and its `effectiveTimeUtc` must equal the observed activation exactly.
2. The multiplier-history `reason` is never used.
3. Only `CashDividend` books income. `ForwardSplit`/`ReverseSplit`/`UnitSplit` rescale the floor, and their unit ratio must reconcile with the multipliers. Everything else, including `SpinOff`, `StockDividend` and mergers, is **unclassified** until there is an explicit product policy.
4. Zero or multiple matches, or a time mismatch, means unclassified. An unclassified change books no income and makes nothing available to convert.
5. USD income = shares held at the event × `netCashflowUsd`. When a market price is available, the implied reinvestment price must fall within ±20% of it; otherwise the event is valued at market and flagged. Missing cash means USD `null`, never zero.

## Consequences

- 8 real dividend changes with no published corporate action (STRCx ×2, SATAx, TQQQx, CMCSAx, LINx, NVOx, JPMx) show as "classification pending". Accuracy is traded for coverage on purpose.
- Classification depends on one issuer feed. If it becomes unavailable, the tracker degrades to unclassified adjustments rather than guessing.
- Spin-off and stock-dividend policy is an open product decision, not an engineering default.
