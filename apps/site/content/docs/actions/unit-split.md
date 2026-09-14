---
title: Unit split
description: A change in the number of wrapper units per underlying share, as the issuer's enum defines it.
---

> [!WARNING] Unvalidated
> No real instance has confirmed this classifier. It is recognised and never booked: every instance is an unclassified adjustment with conversion disabled.

| | |
|---|---|
| Type | `unit_split` |
| Category | basis |
| Ledger treatment | Not booked |
| Validation status | **Unvalidated** |
| Real instances | **0** |

## What we detect

A reconciling `UnitSplit` record is recognised and not booked. A 1:1 `UnitSplit` with issuer cash and a note naming warrants or rights is a rights distribution.

## Evidence required

- A standing record matching both multipliers and the activation time.
- The unit ratio reconciles.

## When evidence is missing or conflicts

- Ratio does not reconcile: unclassified.
- Always: an unclassified adjustment, reason stating that no real instance exists and the classifier is unvalidated.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert.

## Real instances

None. The only `UnitSplit`-labelled record, KRAQx 2026-03-26, was a rights sale.

Census note: The only UnitSplit-labelled record (KRAQx 2026-03-26) is a mislabelled rights sale; no true unit split has occurred.

## In the API

- **v2:** `type: "unit_split"`, `treatment: "not_booked"`, `validation.status: "unvalidated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
