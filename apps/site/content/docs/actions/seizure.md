---
title: "Permanent-delegate transfer"
description: "Tokens moved out of a holder's account by the mint's permanent delegate."
---

| Detail | Value |
|---|---|
| Type | `seizure` |
| Category | custody |
| Ledger treatment | Not booked |
| Automatic booking | **Held for review** |
| Real instances | **0** |

## What we detect

Not detected as its own type yet (ADR-0006). See how it is booked below.

## Evidence required

- Would need: the signing authority of each token movement, to tell the holder from the delegate. Wallet history ingestion does not record it today.

## When evidence is missing or conflicts

- Today a delegate transfer out of a tracked wallet is booked as a **withdrawal**: the protected floor scales down proportionally, income is unaffected, and the position still reconciles. It is **not** flagged as a seizure.

## How it is booked

Not booked as its own type.

## Real instances

None on xStocks. One delegate key is permanent delegate on all 832 mints, and its full history (1,685 transactions) contains no transfer or burn out of another owner.

## In the API

- **v2:** `type: "seizure"`, `treatment: "not_booked"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
