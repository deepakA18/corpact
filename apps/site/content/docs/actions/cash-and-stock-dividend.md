---
title: "Cash and stock dividend"
description: "A dividend paid partly in cash and partly in shares."
---

| Detail | Value |
|---|---|
| Type | `cash_and_stock_dividend` |
| Category | basis |
| Ledger treatment | Not booked |
| Automatic booking | **Held for review** |
| Real instances | **0** |

## What we detect

A matching `CashAndStockDividend` record is recognised, and never booked.

## Evidence required

- A standing record matching both multipliers and the activation time.

## When evidence is missing or conflicts

- Always held for review: shown as an unclassified adjustment with its reason, no income booked, conversion disabled.
- Corpact books this type automatically only once a real instance has occurred and been tested.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert. Splitting one multiplier change into income and a stock dividend needs an issuer unit ratio or a price, and neither has a real instance.

## Real instances

None. The type exists in the issuer enum and has never been used.

## In the API

- **v2:** `type: "cash_and_stock_dividend"`, `treatment: "not_booked"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
