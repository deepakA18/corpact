---
title: "Unknown"
description: "A multiplier change no published issuer record explains, or a record of type `Unknown`."
---

| Detail | Value |
|---|---|
| Type | `unknown` |
| Category | unknown |
| Ledger treatment | Not booked |
| Automatic booking | **Held for review** |
| Real instances | **0** |

## What we detect

Any activated multiplier change that no other type claims.

## Evidence required

- None matched.

## When evidence is missing or conflicts

- Always an unclassified adjustment, with the reason.

## How it is booked

Not booked: an unclassified adjustment with its reason. No income, and the change makes nothing available to convert.

## Real instances

Six recorded changes have no issuer record: STRCx ×2, SATAx, TQQQx, CMCSAx and JPMx.

## In the API

- **v2:** `type: "unknown"`, `treatment: "not_booked"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
