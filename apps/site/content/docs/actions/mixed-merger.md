---
title: "Stock and cash merger"
description: "The underlying company is acquired for shares and cash."
---

| Detail | Value |
|---|---|
| Type | `mixed_merger` |
| Category | termination |
| Ledger treatment | Not booked |
| Automatic booking | **Held for review** |
| Real instances | **0** |

## What we detect

A matching `StockAndCashMerger` record is recognised and not booked.

## Evidence required

- A standing record matching both multipliers and the activation time.

## When evidence is missing or conflicts

- Always held for review: shown as an unclassified adjustment with its reason, no income booked, conversion disabled.
- Corpact books this type automatically only once a real instance has occurred and been tested.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert.

## Real instances

None.

## In the API

- **v2:** `type: "mixed_merger"`, `treatment: "not_booked"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
