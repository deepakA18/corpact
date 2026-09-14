---
title: Independent RPC provider
description: Cross-check balances and mint state against a second provider.
---

## Why

Replay against one RPC provider proves the ledger agrees with **that provider**, not with the chain. A provider serving stale or wrong state would reconcile perfectly and still be wrong.

## Configure

```bash
# Must be a different origin from SOLANA_RPC_URL
RECONCILIATION_RPC_URL=https://second-provider.example
```

With it set, the worker cross-checks two things:

- **Wallet balances** at every position rebuild (one `getTokenAccountsByOwner`).
- **Mint multiplier state** for mints with positions, on every mint poll (one `getMultipleAccounts` per 100 mints).

## Slot alignment

The providers rarely answer for the same slot, so a difference is judged carefully:

1. The secondary is read with `minContextSlot` equal to the primary's slot.
2. A difference is re-read on the primary at the secondary's slot or later.
3. It becomes a **disagreement** only when the slots match, or when the primary reports the same value on both sides of the secondary's slot. Otherwise it is **inconclusive**.

Every outcome is appended to `provider_checks`.

## What a disagreement does

- **Conversion.** It is paused for the affected positions, with both values in `conversionDisabledReasons`.
- **The ledger.** History, income and journal are untouched, and reads stay available.
- **Monitoring.** `provider_agreement` goes **critical**.
- **Recovery.** When the providers agree again, the next rebuild lifts the pause.

> [!NOTE] Proven in the demo
> The demo runs a proxy that misreports one balance by one raw unit. It checks that the disagreement is recorded, only that position pauses, the ledger is untouched, monitoring goes critical, and everything clears afterwards.
