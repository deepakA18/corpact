---
title: "Withholding refund"
description: "Tax withheld by mistake on an earlier dividend, passed back to holders."
---

| Detail | Value |
|---|---|
| Type | `withholding_adjustment` |
| Category | income |
| Ledger treatment | Income |
| Automatic booking | **Yes** |
| Real instances | **2** |

## What we detect

A matching `CashDividend` version with zero gross cash, positive net cash, and an issuer note saying withholding tax was wrongly applied and is being passed back. The issuer publishes it as a `Corrected` version of the original dividend, delivered days later as a second multiplier change that starts where the first ended.

## Evidence required

- Everything a cash dividend needs: a standing record, exact multipliers, exact activation time.
- Gross cash zero or absent, net cash positive.
- A note naming withholding (WHT) and saying it was wrong, refunded, deducted or passed back.

## When evidence is missing or conflicts

- Without the note: an ordinary cash dividend, with its gross/withholding/net inconsistency flagged.
- Either way, the original dividend keeps its own evidence. A follow-on `Corrected` version never voids the version it follows.

## How it is booked

Income, like the dividend it corrects, and distinguishable by type. Withholding is deducted once: LINx 1.12 + 0.48 = 1.60, and NVOx 0.2883412 + 0.1232128 = 0.411554, each equal to the original gross.

## Real instances

LINx and NVOx, each refunding tax withheld on its preceding dividend.

## In the API

- **v2:** `type: "withholding_adjustment"`, `treatment: "income"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `dividend`.
