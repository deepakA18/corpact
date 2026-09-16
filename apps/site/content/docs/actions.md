---
title: Corporate actions
description: The corporate-action types Corpact books, the evidence each one needs, and how it reaches the ledger.
---

Every multiplier change is classified from issuer evidence only: never from the size of the change or its label. These are the types Corpact books, each validated against real recorded data.

| Action | Type | Ledger treatment |
|---|---|---|
| [Cash dividend](/docs/actions/cash-dividend) | `cash_dividend` | Income |
| [Withholding refund](/docs/actions/withholding-adjustment) | `withholding_adjustment` | Income |
| [Stock dividend](/docs/actions/stock-dividend) | `stock_dividend` | Quantity and basis adjustment |
| [Forward split](/docs/actions/forward-split) | `forward_split` | Quantity and basis adjustment |
| [Reverse split](/docs/actions/reverse-split) | `reverse_split` | Quantity and basis adjustment |
| [Spin-off](/docs/actions/spin-off) | `spin_off` | Basis allocation |
| [Rights distribution](/docs/actions/rights-distribution) | `rights_distribution` | Basis allocation |
| [Identity change](/docs/actions/identity-change) | `identity_change` | Identity change |

Other types the issuer can publish, such as mergers and redemptions, are recognised and shown with their reason, and are never booked automatically. No number reaches your ledger from an action type Corpact has not proven on real data.

## Lifecycle

Each action moves through `announced → confirmed → activated`, and may end `corrected`, `reversed` or `superseded`. The history is append-only. Every issuer revision before activation is kept as its own step, naming the revision it supersedes, so a type that churned before delivery (SCCOx) keeps all of it.
