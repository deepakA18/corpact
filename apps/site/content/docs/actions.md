---
title: Corporate actions
description: Every action type Corpact recognises, how it is booked, and whether it is booked automatically.
---

Every multiplier change is classified into one of these types, from issuer evidence only: never from the size of the change or its label. Counts are real instances in the recorded xStocks data and on-chain scans.

| Action | Type | Ledger treatment | Automatic booking | Real instances |
|---|---|---|---|---|
| [Cash dividend](/docs/actions/cash-dividend) | `cash_dividend` | Income | Yes | 642 |
| [Withholding refund](/docs/actions/withholding-adjustment) | `withholding_adjustment` | Income | Yes | 2 |
| [Stock dividend](/docs/actions/stock-dividend) | `stock_dividend` | Quantity and basis adjustment | Yes | 1 |
| [Cash and stock dividend](/docs/actions/cash-and-stock-dividend) | `cash_and_stock_dividend` | Not booked | Held for review | 0 |
| [Forward split](/docs/actions/forward-split) | `forward_split` | Quantity and basis adjustment | Yes | 9 |
| [Reverse split](/docs/actions/reverse-split) | `reverse_split` | Quantity and basis adjustment | Yes | 1 |
| [Unit split](/docs/actions/unit-split) | `unit_split` | Not booked | Held for review | 0 |
| [Fractional cash in lieu](/docs/actions/cash-in-lieu) | `cash_in_lieu` | Not booked | Held for review | 0 |
| [Spin-off](/docs/actions/spin-off) | `spin_off` | Basis allocation | Yes | 6 |
| [Rights distribution](/docs/actions/rights-distribution) | `rights_distribution` | Basis allocation | Yes | 1 |
| [Stock-for-stock merger](/docs/actions/stock-merger) | `stock_merger` | Not booked | Held for review | 0 |
| [Cash merger](/docs/actions/cash-merger) | `cash_merger` | Not booked | Held for review | 0 |
| [Stock and cash merger](/docs/actions/mixed-merger) | `mixed_merger` | Not booked | Held for review | 0 |
| [Identity change](/docs/actions/identity-change) | `identity_change` | Identity change | Yes | 1 |
| [Redemption or wrapper discontinuation](/docs/actions/redemption) | `redemption` | Not booked | Held for review | 0 |
| [Delisting or worthless removal](/docs/actions/delisting) | `delisting` | Not booked | Held for review | 0 |
| [Permanent-delegate transfer](/docs/actions/seizure) | `seizure` | Not booked | Held for review | 0 |
| [Unknown](/docs/actions/unknown) | `unknown` | Not booked | Held for review | 0 |

## Automatic booking

- **Yes:** proven against every real recorded instance, and locked by regression tests on that data.
- **Held for review:** recognised, but it has never occurred on xStocks. Corpact shows it with its reason and books nothing until a real instance has been observed and tested.

## Lifecycle

Each action moves through `announced → confirmed → activated`, and may end `corrected`, `reversed` or `superseded`. The history is append-only. Every issuer revision before activation is kept as its own step, naming the revision it supersedes, so a type that churned before delivery (SCCOx) keeps all of it.
