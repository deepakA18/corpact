---
title: "Rights distribution"
description: "Subscription rights or warrants distributed to holders."
---

| Detail | Value |
|---|---|
| Type | `rights_distribution` |
| Category | basis |
| Ledger treatment | Basis allocation |
| Automatic booking | **Yes** |
| Real instances | **1** |

## What we detect

Sold rights: a `UnitSplit` record whose 1:1 ratio cannot explain a multiplier increase, with positive issuer cash and a note naming warrants or rights. A record labelled `RightsDistribution` is recognised and not booked, because its delivery has never been observed.

## Evidence required

- A standing record matching both multipliers and the activation time.
- A 1:1 unit ratio, a multiplier increase, and positive issuer cash.
- An issuer note naming warrants or rights.

## When evidence is missing or conflicts

- Without the note: an unclassified unit split, "factor 1:1 does not reconcile".
- A `RightsDistribution` label: held for review.
- Exercised or lapsed rights: held for review.

## How it is booked

**Basis allocation**, as for a spin-off: (M_new − M_old) ÷ M_new of the position's value as principal. Issuer proceeds are recorded when published, and never booked as income.

## Real instances

KRAQx: 18,606 warrants sold at $0.5553 less a $100 subscription fee, reinvested at $0.1356647/share. Three versions; v2 cancelled v1 for the fee miscalculation, and only v3 matches the chain.

## In the API

- **v2:** `type: "rights_distribution"`, `treatment: "basis_allocation"`, with `validation`, the lifecycle and the evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`, with the treatment stated in `reasons` and `headline`.
