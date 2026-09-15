---
title: "Unit split"
description: "A change in the number of wrapper units per underlying share, as the issuer's enum defines it."
---

| Detail | Value |
|---|---|
| Type | `unit_split` |
| Category | basis |
| Ledger treatment | Not booked |
| Automatic booking | **Held for review** |
| Real instances | **0** |

## What we detect

A reconciling `UnitSplit` record is recognised and not booked. A 1:1 `UnitSplit` with issuer cash and a note naming warrants or rights is a rights distribution.

## Evidence required

- A standing record matching both multipliers and the activation time.
- The unit ratio reconciles.

## When evidence is missing or conflicts

- Ratio does not reconcile: unclassified.
- Always held for review: shown as an unclassified adjustment with its reason, no income booked, conversion disabled.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert.

## Real instances

None. The only `UnitSplit`-labelled record, on KRAQx, was a rights sale.

## In the API

- **v2:** `type: "unit_split"`, `treatment: "not_booked"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
