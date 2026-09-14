---
title: Permanent-delegate transfer
description: Tokens moved out of a holder's account by the mint's permanent delegate.
---

> [!WARNING] Not built
> Recognised in the taxonomy only. See ADR-0006 for why, and for what happens today.

| | |
|---|---|
| Type | `seizure` |
| Category | custody |
| Ledger treatment | Not booked |
| Validation status | **Not built** |
| Real instances | **0** |

## What we detect

Nothing. The detector is deliberately not built (ADR-0006).

## Evidence required

- Would need: the signing authority of each token movement, to tell the holder from the delegate. Wallet history ingestion does not record it today.

## When evidence is missing or conflicts

- Today a delegate transfer out of a tracked wallet is booked as a **withdrawal**: the protected floor scales down proportionally, income is unaffected, and the position still reconciles. It is **not** flagged as a seizure.

## How it is booked

Not booked as its own type.

## Real instances

None on xStocks. One delegate key is permanent delegate on all 832 mints, and its full history (1,685 transactions) contains no transfer or burn out of another owner.

Census note: One delegate on all 832 mints; its full history (1,685 transactions) has no transfer or burn out of another owner. Left not built: see ADR-0006.

## In the API

- **v2:** `type: "seizure"`, `treatment: "not_booked"`, `validation.status: "not_built"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
