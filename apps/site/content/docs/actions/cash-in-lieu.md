---
title: "Fractional cash in lieu"
description: "Cash paid for a fractional share left over by a split."
---

| Detail | Value |
|---|---|
| Type | `cash_in_lieu` |
| Category | basis |
| Ledger treatment | Not booked |
| Automatic booking | **Held for review** |
| Real instances | **0** |

## What we detect

A split record that publishes cash is recognised as cash in lieu, and not booked.

## Evidence required

- A split record that reconciles and publishes non-zero gross or net cash.

## When evidence is missing or conflicts

- Always held for review: shown as an unclassified adjustment with its reason, no income booked, conversion disabled.
- Corpact books this type automatically only once a real instance has occurred and been tested.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert. A Scaled UI split rescales the multiplier, so raw token amounts never become fractional. This path is structurally unlikely, not merely unobserved.

## Real instances

None.

## In the API

- **v2:** `type: "cash_in_lieu"`, `treatment: "not_booked"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
