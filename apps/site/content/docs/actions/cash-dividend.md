---
title: "Cash dividend"
description: "Cash paid on the underlying share and reinvested by the issuer through the multiplier."
---

| Detail | Value |
|---|---|
| Type | `cash_dividend` |
| Category | income |
| Ledger treatment | Income |

## What we detect

A multiplier increase that matches a standing `CashDividend` record exactly: both multipliers, and the activation time to the second.

## Evidence required

- A standing issuer version: `Initial` or `Corrected`, not cancelled. `Scheduled` announcements are never evidence.
- `multiplierOld` and `multiplierNew` equal the mint's f64 values, within 4ε.
- The record's effective time equals the on-chain activation.
- Exactly one record matches.

## When evidence is missing or conflicts

- No matching record: unclassified, "No published issuer action matches the observed multiplier change".
- Effective time differs from the activation: unclassified, with both times in the reason.
- More than one record matches: unclassified, naming the records.
- No usable net cash: still a dividend, with USD **null** (unknown, never zero).
- Net cash implying a reinvestment price outside ×3 of the median of the same asset's other dividends (STRCx: ~$953,728/share): still a dividend, with USD null and a warning.
- Gross × (1 − withholding) ≠ net: valued, with the inconsistency flagged.
- A 5% currency retention in the withholding field, with a note saying so (LINx, ETNx, ASMLx): recognised as `retentionRate`. It is not tax and is not deducted again.

## How it is booked

Units added are **income**. The protected floor is unchanged. USD = shares held at the event × issuer net cash per share.

## In practice

LINx, ETNx, ASMLx and TSMx cover the retention and retention-release cases; STRCx covers implausible issuer cash.

## In the API

- **v2:** `type: "cash_dividend"`, `treatment: "income"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `dividend`.
