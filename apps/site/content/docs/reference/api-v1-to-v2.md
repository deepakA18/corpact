---
title: API v1 → v2
description: What v2 adds for corporate actions, and exactly how v1 presents the same data without changing its semantics.
---

API v2 reports every change to a position as a **corporate action**. Each action carries its taxonomy type, lifecycle, distinct timestamps, evidence hashes and validation status. v1 is unchanged: same routes, same kinds, same response shapes. Both versions read the same ledger, so they never disagree about income.

## New in v2

| Route | Returns |
|---|---|
| `GET /v2/taxonomy` | Every action type: category, ledger treatment, validation status, real-instance count, census evidence |
| `GET /v2/actions?owner=` | Actions applied to a wallet, newest first: `type`, `treatment`, `validation`, `lifecycle.state`, amounts and an evidence summary |
| `GET /v2/actions/{id}?owner=` | One action: the full lifecycle, six distinct timestamps, every stored issuer revision with its hash, chain evidence, journal history, and lineage |
| `GET /v2/instruments/{mint}/lineage` | A mint's recorded identities, the lineage links between them, and where the earliest identity's basis is now |

The TypeScript client exposes them as `client.v2.taxonomy()`, `client.v2.actions(wallet)`, `client.v2.action(wallet, id)` and `client.v2.lineage(mint)`.

## How v1 presents each type

v1 predates the taxonomy. Types it never booked appear there as unclassified adjustments. That is true as far as it goes: no income, nothing convertible. The treatment is spelled out in `reasons` and `headline`.

| v2 `type` | v2 `treatment` | v1 `kind` | v1 `splitFactor` | v1 `reasons` |
|---|---|---|---|---|
| `cash_dividend` | `income` | `dividend` | null | unchanged |
| `withholding_adjustment` | `income` | `dividend` | null | unchanged |
| `forward_split`, `reverse_split` | `quantity_basis` | `split` | the factor | unchanged |
| `stock_dividend` | `quantity_basis` | `unclassified_adjustment` | null | "Stock dividend booked as a quantity adjustment, not income: units ×F, with cost basis spread across them" |
| `spin_off` | `basis_allocation` | `unclassified_adjustment` | null | "Spin-off booked as a basis allocation, not income: X% of the position's value was distributed and reinvested" |
| `rights_distribution` | `basis_allocation` | `unclassified_adjustment` | null | "Rights distribution booked as a basis allocation, not income: X% of the position's value came from rights sold and reinvested" |
| `identity_change` | `identity` | `unclassified_adjustment` | null | "Identity change of the underlying booked as a quantity adjustment, not income: units ×F, all cost basis carried over" |
| anything held for review or unmatched | `not_booked` | `unclassified_adjustment` | null | the classifier's reason |

The same mapping applies everywhere v1 shows a kind: `/v1/income`, `/v1/income/{id}` (including `evidence.classification.result`, which reads `unclassified` for these types), `/v1/journal`, and both CSV exports. `/v1/portfolio` counts them in `unclassifiedAdjustments`.

## Field-level differences

| Concern | v1 | v2 |
|---|---|---|
| What an entry is | `kind`: `dividend`, `split` or `unclassified_adjustment` | `type` (18 values) plus `treatment` (5 values) |
| Booked automatically? | Implicit | `validation.status`: `validated`, `unvalidated` or `not_built`, with `realInstances` |
| Where it is in its life | Not reported | `lifecycle.state`. Detail adds every step, and the revision each step supersedes |
| Timestamps | `effectiveAt`; the detail's chain block has `scheduledAt` and `effectiveAt` | Detail `timestamps`: issuer effective, issuer created, configured activation, publication block time, first observed active, ingested |
| Evidence hash | `evidenceSha256`: hash of the payload at ingestion | `evidenceSha256`: `stored_payload_sha256`, recomputable from the database; every revision carries its own |
| Issuer revisions | The matched record only | Every stored revision, including cancelled and superseded ones |
| Spin-offs and rights | Unclassified adjustment | `distributedFraction` = (M_new − M_old) ÷ M_new, plus `proceedsUsd` when published and plausible. Never income |
| Stock dividends, identity changes | Unclassified adjustment, no factor | `factor`. Identity changes also carry `underlying.from` and `underlying.to`, and the `lineage` link |
| Withholding refunds | `dividend` | `type: withholding_adjustment` with `refundNote` |
| Currency retention | Not reported | `retentionRate` |
| Dataset label | On list responses | On list, detail and lineage responses |

> [!NOTE] Unchanged in both versions
> USD is null when unknown, never zero. Quantities and values are exact decimal strings. The journal is append-only. Synthetic data is labelled in the body, the `x-corpact-dataset` header and exports.

## What changed in v1's output

v1's semantics did not change: kinds, amounts, income totals and response shapes are the same. Three pieces of **text** did, because the classifier now has better evidence:

- Stock dividends, rights and identity changes carry the reasons and headlines above. Before, they read "no income policy" or "does not reconcile".
- Withholding refunds no longer carry the "Issuer gross/withholding/net are inconsistent" warning. They carry "Withholding refund: passes back tax withheld on an earlier distribution; not a new dividend" instead.
- The two dividends those refunds correct (on LINx and NVOx) had no matching issuer record before, and now match. They move from `unclassified_adjustment` to `dividend`, with issuer-valued USD. The refund's `Corrected` record had wrongly displaced them; see [Withholding refund](/docs/actions/withholding-adjustment).
