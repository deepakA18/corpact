---
title: "Stock dividend"
description: "New shares distributed to holders, delivered as a multiplier increase."
---

| | |
|---|---|
| Type | `stock_dividend` |
| Category | basis |
| Ledger treatment | Quantity and basis adjustment |
| Validation status | **Validated** |
| Real instances | **1** |

## What we detect

A multiplier increase matching the delivered `StockDividend` record.

## Evidence required

- A standing (delivered) version matching both multipliers and the activation time.
- The multiplier increases.
- If the delivered record publishes a unit ratio, it must reconcile. Otherwise the factor is M_new ÷ M_old.

## When evidence is missing or conflicts

- Only announcements or cancellations: unclassified, since no delivered record matches.
- A published ratio that does not reconcile: unclassified, stating the ratio and both multipliers.
- A ratio stated by an earlier, superseded version is reported as a warning and never used.

## How it is booked

Units ×factor, with cost basis spread across them. The protected floor scales by the same factor. Zero income; nothing newly convertible.

## Real instances

SCCOx. The issuer published six versions across two feeds: scheduled at 1:1.012, cancelled ("Will be a cash flow, not a unit change"), cancelled again, rescheduled, delivered at ×1.0153, then the schedule was cancelled after delivery. The lifecycle keeps all six, each naming the revision it supersedes.

Census note: SCCOx: six versions across both issuer feeds (scheduled 1:1.012, cancelled "Will be a cash flow", rescheduled, delivered ×1.0153); resolved on the delivered record.

## In the API

- **v2:** `type: "stock_dividend"`, `treatment: "quantity_basis"`, `validation.status: "validated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`, with the treatment stated in `reasons` and `headline`.
