---
title: "Redemption or wrapper discontinuation"
description: "The wrapper is redeemed or discontinued and holders are paid out."
---

| Detail | Value |
|---|---|
| Type | `redemption` |
| Category | termination |
| Ledger treatment | Not booked |
| Automatic booking | **Held for review** |
| Real instances | **0** |

## What we detect

A matching `Redemption` record is recognised and not booked.

## Evidence required

- A standing record matching both multipliers and the activation time.

## When evidence is missing or conflicts

- Always held for review: shown as an unclassified adjustment with its reason, no income booked, conversion disabled.
- Corpact books this type automatically only once a real instance has occurred and been tested.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert. The lineage model has a `terminate` link (all basis leaves as cash), but nothing writes one.

## Real instances

None. No record uses `Redemption` or `redemptionPriceUsd`. Four assets are marked halted, and none has terminated.

## In the API

- **v2:** `type: "redemption"`, `treatment: "not_booked"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
