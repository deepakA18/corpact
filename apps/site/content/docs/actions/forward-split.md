---
title: "Forward split"
description: "More shares per share; each is worth proportionally less."
---

| Detail | Value |
|---|---|
| Type | `forward_split` |
| Category | basis |
| Ledger treatment | Quantity and basis adjustment |
| Automatic booking | **Yes** |
| Real instances | **9** |

## What we detect

A multiplier change matching a standing `ForwardSplit` record whose unit ratio reconciles with the multipliers.

## Evidence required

- A standing record matching both multipliers and the activation time.
- M_old × (toUnits ÷ fromUnits) equals M_new within 4ε. With no published ratio, the factor is derived and a warning says so.

## When evidence is missing or conflicts

- A ratio that does not reconcile: unclassified.
- A split record publishing cash: recognised as fractional cash in lieu and held for review.

## How it is booked

Units ×factor. The protected floor ×factor. Zero income.

## Real instances

NFLXx 10:1, VUGx 6:1, KLACx 10:1, CRWDx 4:1 and others, each reconciled to the issuer unit ratio.

## In the API

- **v2:** `type: "forward_split"`, `treatment: "quantity_basis"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `split`.
