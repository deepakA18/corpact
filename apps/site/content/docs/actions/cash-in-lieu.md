---
title: Fractional cash in lieu
description: Cash paid for a fractional share left over by a split.
---

> [!WARNING] Unvalidated
> No real instance has confirmed this classifier. It is recognised and never booked: every instance is an unclassified adjustment with conversion disabled.

| | |
|---|---|
| Type | `cash_in_lieu` |
| Category | basis |
| Ledger treatment | Not booked |
| Validation status | **Unvalidated** |
| Real instances | **0** |

## What we detect

A split record that publishes cash is recognised as cash in lieu, and not booked.

## Evidence required

- A split record that reconciles and publishes non-zero gross or net cash.

## When evidence is missing or conflicts

- Always: an unclassified adjustment, reason stating that no real instance exists and the classifier is unvalidated.
- No fixture is invented for this type; tests only retype a real record to prove it is never booked.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert. A Scaled UI split rescales the multiplier, so raw token amounts never become fractional. This path is structurally unlikely, not merely unobserved.

## Real instances

None.

Census note: No split record publishes cash. A Scaled UI split rescales the multiplier, so raw token amounts never become fractional; a split carrying cash is recognised, labelled unvalidated and never booked.

## In the API

- **v2:** `type: "cash_in_lieu"`, `treatment: "not_booked"`, `validation.status: "unvalidated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
