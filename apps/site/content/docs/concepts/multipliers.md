---
title: Scaled UI multipliers
description: How tokenized stocks pay dividends without moving a single token.
---

## Raw balance and displayed quantity

xStocks are Token-2022 mints with the **Scaled UI Amount** extension. A token account holds a raw integer balance; wallets display that balance multiplied by the mint's multiplier:

```text
displayed quantity = raw balance ÷ 10^decimals × multiplier
```

| | Raw base units | Multiplier | Displayed |
|---|---|---|---|
| Before a dividend | `10000000000` | `1` | `100` |
| After a dividend | `10000000000` | `1.0035` | `100.35` |

The raw balance never changed, and neither did the account. The holder's stock exposure grew by 0.35 units.

## Scheduled activation

The issuer writes the next multiplier **with an activation timestamp**. The mint stores both values:

```text
ScaledUiAmountConfig { authority, multiplier, newMultiplierEffectiveTimestamp, newMultiplier }
```

Once cluster time passes the timestamp, `newMultiplier` is the live value, but the stored `multiplier` field **still holds the previous one**. Reading `multiplier` alone is wrong after every activation. Corpact derives the active value from the finalized cluster clock.

> [!IMPORTANT] Income with no account write
> Activation is not a transaction. Nothing appears in a transfer feed, a signature history or an account-change subscription. Corpact finds activations from the stored schedule and settles them on finalized time.

## Corpact's timeline

The worker replays every multiplier write through the Token-2022 processor rules:

- **Pending values.** A pending value whose time has passed is promoted before the next write applies.
- **Superseded schedules.** A pending value overwritten before its time is `superseded` and never becomes live.
- **Past timestamps.** A write with a past timestamp applies immediately, at publication. That is a late publication, not missing history.
- **Re-asserts.** A write that re-asserts the current value is not a change. Issuers write a re-assert followed by the next schedule in one transaction.

Two writes in one slot are ordered by their transaction index within the block, never guessed.

## Numbers are exact

Multipliers are 64-bit floats on chain. Corpact stores their exact bytes and lifts them into exact rationals, so no rounding enters the ledger. Issuer decimals are compared with the chain value within 4ε, because the issuer's own endpoints disagree in the last representable digit.
