---
title: Synthetic vs mainnet data
description: How a response tells you whether it came from real chain history.
---

## The dataset label

Every ledger database is one of two kinds:

| `dataset.kind` | Holds |
|---|---|
| `mainnet` | Real Solana chain history |
| `synthetic` | Generated demo data on a local network |

A database is synthetic only if it carries a label, written once by the demo. The label table is append-only, so a synthetic database can never be relabelled real.

## Where it appears

- **Responses.** Portfolio, income, journal, yield and health include `dataset: { kind, description }`.
- **Headers.** Every response carries `x-corpact-dataset: mainnet | synthetic`.
- **CSV exports.** Every row starts with a `dataset` column, and synthetic files are named `corpact-SYNTHETIC-…`.
- **Dashboard.** A synthetic database shows a **SYNTHETIC DEMO DATA** banner on every page.

```json
{
  "owner": "4zAX3B1QNWBvrMHQMxxjNUqQBecCFcaokULF1zkBAfyw",
  "dataset": { "kind": "synthetic", "description": "SYNTHETIC demo run …: generated keys, mints and issuer records on a local surfpool network (offline). Not mainnet history, not issuer data." }
}
```

> [!TIP] Branch on it
> An integration that stores Corpact data should store `dataset.kind` beside it, and refuse synthetic data anywhere a real number is expected.
