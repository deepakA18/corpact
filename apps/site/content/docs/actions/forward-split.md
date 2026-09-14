---
title: Forward split
description: More shares per share; each is worth proportionally less.
---

| | |
|---|---|
| Type | `forward_split` |
| Category | basis |
| Ledger treatment | Quantity and basis adjustment |
| Validation status | **Validated** |
| Real instances | **9** |

## What we detect

A multiplier change matching a standing `ForwardSplit` record whose unit ratio reconciles with the multipliers.

## Evidence required

- A standing record matching both multipliers and the activation time.
- M_old × (toUnits ÷ fromUnits) equals M_new within 4ε. With no published ratio, the factor is derived and a warning says so.

## When evidence is missing or conflicts

- A ratio that does not reconcile: unclassified.
- A split record publishing cash: recognised as fractional cash in lieu, unvalidated, not booked.

## How it is booked

Units ×factor. The protected floor ×factor. Zero income.

## Real instances

NFLXx 10:1, VUGx 6:1, KLACx 10:1, CRWDx 4:1 and others, each reconciled to the issuer unit ratio.

Census note: NFLXx 10:1, VUGx 6:1, KLACx 10:1, CRWDx 4:1, … reconciled to issuer unit ratios.

## In the API

- **v2:** `type: "forward_split"`, `treatment: "quantity_basis"`, `validation.status: "validated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `split`.
