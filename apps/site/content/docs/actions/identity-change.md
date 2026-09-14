---
title: "Identity change"
description: "The same economic position under a new underlying listing or form."
---

| | |
|---|---|
| Type | `identity_change` |
| Category | identity |
| Ledger treatment | Identity change |
| Validation status | **Validated** |
| Real instances | **1** |

## What we detect

A matching `StockMerger` record whose note exchanges one listing of a company for another listing of the same company, at a ratio that reconciles exactly. For example: "Stock Merger 0.5 NYSE:AZN for 1 NASDAQ:AZN (ADR)". A `NameChange` record is recognised and not booked: a rename has no real instance.

## Evidence required

- A standing record matching both multipliers and the activation time.
- An issuer note in the form `Stock Merger <qty> <venue>:<ticker> for <qty> <venue>:<ticker>`, with the same ticker on both sides.
- The note ratio equals the published unit ratio, and M_old × ratio equals M_new within 4ε.

## When evidence is missing or conflicts

- No note, or a note naming a different company: an unclassified stock merger, unvalidated.
- A ratio that does not reconcile: unclassified.
- `NameChange`: unclassified, unvalidated.

## How it is booked

Units ×ratio, all cost basis carried over; the protected floor scales by the ratio. Zero income. The worker writes the position lineage: the identity held before, the identity after, and a link whose successor carries exactly all basis. `GET /v2/instruments/{mint}/lineage` traces it.

## Real instances

AZNx: NASDAQ ADR → NYSE ordinary share, 2:1. Labelled `StockMerger` by the issuer and "ReverseSplit" by multiplier history.

Census note: AZNx: NASDAQ ADR → NYSE ordinary share 2:1, labelled StockMerger and "ReverseSplit". Name or ticker changes (NameChange): 0 instances, unvalidated.

## In the API

- **v2:** `type: "identity_change"`, `treatment: "identity"`, `validation.status: "validated"`, and the lifecycle and evidence on `GET /v2/actions/{id}`.
- **v1:** shown as `unclassified_adjustment`, with the treatment stated in `reasons` and `headline`.
