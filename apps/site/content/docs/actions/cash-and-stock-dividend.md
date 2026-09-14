---
title: "Cash and stock dividend"
description: "A dividend paid partly in cash and partly in shares."
---

> [!WARNING] Unvalidated
> No real instance has confirmed this classifier. It is recognised and never booked: every instance is an unclassified adjustment with conversion disabled.

| | |
|---|---|
| Type | `cash_and_stock_dividend` |
| Category | basis |
| Ledger treatment | Not booked |
| Validation status | **Unvalidated** |
| Real instances | **0** |

## What we detect

A matching `CashAndStockDividend` record is recognised, and never booked.

## Evidence required

- A standing record matching both multipliers and the activation time.

## When evidence is missing or conflicts

- Always: an unclassified adjustment, reason stating that no real instance exists and the classifier is unvalidated.
- No fixture is invented for this type; tests only retype a real record to prove it is never booked.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert. Splitting one multiplier change into income and a stock dividend needs an issuer unit ratio or a price, and neither has a real instance.

## Real instances

None. The type exists in the issuer enum and has never been used.

Census note: Defined in the issuer enum; never used. Recognised and labelled unvalidated; never booked.

## In the API

- **v2:** `type: "cash_and_stock_dividend"`, `treatment: "not_booked"`, `validation.status: "unvalidated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
