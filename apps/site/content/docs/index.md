---
title: Overview
description: What Corpact is, what it gives you, and where to start.
---

## What Corpact does

Tokenized stocks such as xStocks on Solana pay dividends by **changing a multiplier on the mint**. The Token-2022 *Scaled UI Amount* extension multiplies every raw balance for display. When a dividend activates, holders own more stock-equivalent units, yet **no transaction touches their account**. Anything that follows transfers sees nothing.

Corpact is an API that turns those multiplier changes into an evidence-backed ledger:

- **Verified dividends, splits and pending changes.** Each one is matched to the issuer's own corporate action, never inferred from the size or label of the change.
- **Positions with a protected floor.** Units that came from dividends are kept apart from principal, and splits adjust the basis.
- **Coverage on every number.** A position is `complete`, `partial` or `unsupported`. Partial history never produces a yield claim.
- **An append-only journal.** Issuer corrections become a reversal plus a replacement, and nothing is edited.
- **Reconciliation.** Every replay is checked against the exact raw chain balance, and optionally against an independent RPC provider.

> [!NOTE] Private preview
> Corpact runs today against recorded issuer data (`ISSUER_SOURCE=fixtures`) and live Solana chain data. The live issuer feed is switched off until the data licence is settled.

## How the pieces fit

| Component | What it does |
|---|---|
| **Worker** | Reads chain history and mint state, rebuilds the multiplier timeline, classifies changes and replays positions into Postgres |
| **API** | Serves portfolio, income, journal, yield and exports to API keys scoped by tenant |
| **`@corpact/client`** | Typed TypeScript client generated from the same schemas as the API |
| **Dashboard** | A reference UI that calls the API through its own server |

## Where to start

- **See it work locally:** [Running the demo](/docs/operations/demo) runs the whole flow on a local Surfpool network, with synthetic data.
- **Sync a real wallet:** follow the [Quickstart](/docs/quickstart).
- **Understand the numbers:** read [Classification from evidence](/docs/concepts/classification) and [Coverage & partial history](/docs/concepts/coverage).
- **Integrate:** see [Authentication](/docs/authentication), then the [API reference](/docs/api-reference).
