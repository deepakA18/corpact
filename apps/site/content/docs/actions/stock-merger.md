---
title: "Stock-for-stock merger"
description: "The underlying company is acquired for shares of another company."
---

| Detail | Value |
|---|---|
| Type | `stock_merger` |
| Category | identity |
| Ledger treatment | Not booked |
| Automatic booking | **Held for review** |
| Real instances | **0** |

## What we detect

A matching `StockMerger` record is recognised and not booked, unless its note exchanges one listing of a company for another listing of the *same* company. That is an identity change.

## Evidence required

- A standing record matching both multipliers and the activation time.

## When evidence is missing or conflicts

- A note naming a different company: held for review, since a stock-for-stock merger has never occurred.
- Always held for review: shown as an unclassified adjustment with its reason, no income booked, conversion disabled.
- Corpact books this type automatically only once a real instance has occurred and been tested.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert. The lineage model supports a `transform` link, and its basis conservation is property-tested, but nothing writes one.

## Real instances

None. The only `StockMerger` record, AZNx, is a listing conversion.

## In the API

- **v2:** `type: "stock_merger"`, `treatment: "not_booked"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
