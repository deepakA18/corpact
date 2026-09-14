---
title: Redemption or wrapper discontinuation
description: The wrapper is redeemed or discontinued and holders are paid out.
---

> [!WARNING] Unvalidated
> No real instance has confirmed this classifier. It is recognised and never booked: every instance is an unclassified adjustment with conversion disabled.

| | |
|---|---|
| Type | `redemption` |
| Category | termination |
| Ledger treatment | Not booked |
| Validation status | **Unvalidated** |
| Real instances | **0** |

## What we detect

A matching `Redemption` record is recognised and not booked.

## Evidence required

- A standing record matching both multipliers and the activation time.

## When evidence is missing or conflicts

- Always: an unclassified adjustment, reason stating that no real instance exists and the classifier is unvalidated.
- No fixture is invented for this type; tests only retype a real record to prove it is never booked.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert. The lineage model has a `terminate` link (all basis leaves as cash), but nothing writes one.

## Real instances

None. No record uses `Redemption` or `redemptionPriceUsd`. Four assets are marked halted, and none has terminated.

Census note: No record uses Redemption or redemptionPriceUsd; 4 assets are marked halted without termination. Recognised and labelled unvalidated; never booked.

## In the API

- **v2:** `type: "redemption"`, `treatment: "not_booked"`, `validation.status: "unvalidated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
