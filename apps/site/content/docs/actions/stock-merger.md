---
title: Stock-for-stock merger
description: The underlying company is acquired for shares of another company.
---

> [!WARNING] Unvalidated
> No real instance has confirmed this classifier. It is recognised and never booked: every instance is an unclassified adjustment with conversion disabled.

| | |
|---|---|
| Type | `stock_merger` |
| Category | identity |
| Ledger treatment | Not booked |
| Validation status | **Unvalidated** |
| Real instances | **0** |

## What we detect

A matching `StockMerger` record is recognised and not booked, unless its note exchanges one listing of a company for another listing of the *same* company. That is an identity change.

## Evidence required

- A standing record matching both multipliers and the activation time.

## When evidence is missing or conflicts

- A note naming a different company: unclassified, "a different company; stock-for-stock mergers are unvalidated".
- Always: an unclassified adjustment, reason stating that no real instance exists and the classifier is unvalidated.
- No fixture is invented for this type; tests only retype a real record to prove it is never booked.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert. The lineage model supports a `transform` link, and its basis conservation is property-tested, but nothing writes one.

## Real instances

None. The only `StockMerger` record, AZNx, is a listing conversion.

Census note: The only StockMerger-labelled record (AZNx) is a listing conversion of the same company, classified as an identity change; no merger into another company has occurred.

## In the API

- **v2:** `type: "stock_merger"`, `treatment: "not_booked"`, `validation.status: "unvalidated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
