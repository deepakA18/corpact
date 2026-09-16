---
title: Overview
description: What Corpact is, what it gives you, and where to start.
---

## Start here

New to Corpact? Pick the path that matches what you want to do.

1. **See it work, about 5 minutes.** [Running the demo](/docs/operations/demo) runs the whole flow on a local Solana network with synthetic data, and checks every number through the real API. One command, no keys, no mainnet.
2. **Sync a real wallet, about 15 minutes.** The [Quickstart](/docs/quickstart) starts the worker against mainnet and reads a real position's dividends, splits and coverage.
3. **Integrate.** Read [Authentication](/docs/authentication), then the [API reference](/docs/api-reference). Corporate actions live at `GET /v2/actions`.
4. **Understand the numbers.** [Classification from evidence](/docs/concepts/classification) explains why a change is or is not booked; [Coverage & partial history](/docs/concepts/coverage) explains when a number is withheld.

> [!NOTE] Private preview
> Corpact runs on live Solana chain data with recorded issuer data (`ISSUER_SOURCE=fixtures`). The live issuer feed stays off until the data licence is settled, and there is no hosted sandbox yet, so every path above runs on your own machine.

## What Corpact does

Tokenized stocks such as xStocks on Solana pay dividends by **changing a multiplier on the mint**. The Token-2022 *Scaled UI Amount* extension multiplies every raw balance for display. When a dividend activates, holders own more stock-equivalent units, yet **no transaction touches their account**. Anything that follows transfers sees nothing.

Corpact is an API that turns those multiplier changes into an evidence-backed ledger:

- **Verified dividends, splits and pending changes.** Each one is matched to the issuer's own corporate action, never inferred from the size or label of the change.
- **Positions with a protected floor.** Units that came from dividends are kept apart from principal, and splits adjust the basis.
- **Coverage on every number.** A position is `complete`, `partial` or `unsupported`. Partial history never produces a yield claim.
- **An append-only journal.** Issuer corrections become a reversal plus a replacement, and nothing is edited.
- **Reconciliation.** Every replay is checked against the exact raw chain balance, and optionally against an independent RPC provider.

## How the pieces fit

| Component | What it does |
|---|---|
| **Worker** | Reads chain history and mint state, rebuilds the multiplier timeline, classifies changes and replays positions into Postgres |
| **API** | Serves portfolio, income, journal, yield and exports to API keys scoped by tenant |
| **`@corpact/client`** | Typed TypeScript client generated from the same schemas as the API |
| **Dashboard** | A reference UI that calls the API through its own server |

## Corporate actions

Every multiplier change is classified into one of 18 action types, from issuer evidence only. [Corporate actions](/docs/actions) lists them all, with what each one needs as evidence, how it is booked, and how many real instances exist.
