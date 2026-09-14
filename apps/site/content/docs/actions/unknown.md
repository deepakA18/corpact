---
title: "Unknown"
description: "A multiplier change no published issuer record explains, or a record of type `Unknown`."
---

> [!WARNING] Not built
> Recognised in the taxonomy only. See ADR-0006 for why, and for what happens today.

| | |
|---|---|
| Type | `unknown` |
| Category | unknown |
| Ledger treatment | Not booked |
| Validation status | **Not built** |
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

Census note: No issuer action matches, or the issuer type is Unknown.

## In the API

- **v2:** `type: "unknown"`, `treatment: "not_booked"`, `validation.status: "not_built"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`.
