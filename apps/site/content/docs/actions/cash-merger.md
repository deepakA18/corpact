---
title: "Cash merger"
description: "The underlying company is acquired for cash."
---

> [!WARNING] Unvalidated
> No real instance has confirmed this classifier. It is recognised and never booked: every instance is an unclassified adjustment with conversion disabled.

| | |
|---|---|
| Type | `cash_merger` |
| Category | termination |
| Ledger treatment | Not booked |
| Validation status | **Unvalidated** |
| Real instances | **0** |

## What we detect

A matching `CashMerger` record is recognised and not booked.

## Evidence required

- A standing record matching both multipliers and the activation time.

## When evidence is missing or conflicts

- Always: an unclassified adjustment, reason stating that no real instance exists and the classifier is unvalidated.
- No fixture is invented for this type; tests only retype a real record to prove it is never booked.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert. How xStocks would deliver cash for a delisted underlying (multiplier to zero, burn, off-chain redemption) is unknown.

## Real instances

None.

Census note: Defined in the issuer enum; never used. Recognised and labelled unvalidated; never booked.

## In the API

- **v2:** `type: "cash_merger"`, `treatment: "not_booked"`, `validation.status: "unvalidated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
