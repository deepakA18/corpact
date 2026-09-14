---
title: Protected floor
description: Separating dividend growth from principal, in stock units.
---

## The idea

A position's displayed quantity mixes two things: the units the holder put in, and the units dividends added. Corpact tracks a **protected floor**, the stock-quantity principal, so the dividend-attributed part is always known:

```text
available to convert = displayed quantity − protected floor   (rounded toward zero)
```

| Event | Displayed | Protected floor | Available |
|---|---|---|---|
| Deposit 100 | 100.00 | 100.00 | 0.00 |
| Dividend (+0.35%) | 100.35 | 100.00 | 0.35 |
| 2-for-1 split | 200.70 | 200.00 | 0.70 |

## Rules

- **Deposits** raise the floor by the displayed quantity received.
- **Withdrawals** consume available units first, then the floor.
- **Verified dividends** raise the displayed quantity and leave the floor unchanged.
- **Splits** scale the floor by the split factor: a split is never income.
- **Unclassified adjustments** move quantity with no income attributed.

The floor is an exact rational, never a float, and availability rounds **toward zero**. The API never shows more convertible exposure than exists.

## Availability is gated

`availableQuantity` is `null` when replay did not complete. Conversion itself is not enabled in this release, and `conversionDisabledReasons` always explains why a position cannot convert:

- **Release gating:** conversion is not enabled in this release.
- **Replay or reconciliation:** replay did not complete, or reconciliation found a mismatch.
- **Recent correction:** a recent issuer correction pauses conversion for 7 days of review.
- **Provider disagreement:** an independent RPC provider disagrees on the balance or the mint state.
