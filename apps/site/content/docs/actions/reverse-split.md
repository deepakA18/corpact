---
title: Reverse split
description: Fewer shares per share; each is worth proportionally more.
---

| | |
|---|---|
| Type | `reverse_split` |
| Category | basis |
| Ledger treatment | Quantity and basis adjustment |
| Validation status | **Validated** |
| Real instances | **1** |

## What we detect

A multiplier decrease matching a standing `ReverseSplit` record whose unit ratio reconciles.

## Evidence required

- A standing record matching both multipliers and the activation time.
- The unit ratio reconciles with the multipliers.

## When evidence is missing or conflicts

- A ratio that does not reconcile: unclassified.
- The same ratio is not enough on its own. AZNx halved its multiplier exactly like HONx did, and was an identity change; the issuer record decides.

## How it is booked

Units ×factor. The protected floor ×factor. Zero income.

## Real instances

HONx 2026-06-29, 2:1.

Census note: HONx 2026-06-29 2:1; fractional cash-in-lieu has 0 instances.

## In the API

- **v2:** `type: "reverse_split"`, `treatment: "quantity_basis"`, `validation.status: "validated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `split`.
