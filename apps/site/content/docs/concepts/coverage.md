---
title: Coverage & partial history
description: What complete, partial and unsupported mean, and why partial positions claim no yield.
---

## Every position has a status

| Status | Meaning |
|---|---|
| `complete` | Replayed from the first on-chain movement, with the multiplier known throughout, and reconciled exactly to the chain balance |
| `partial` | Something is missing: an opening balance before retrieved history, a multiplier known only from later, a history gap, or a reconciliation mismatch |
| `unsupported` | The mint's multiplier history has not been reconstructed from chain data |

The reasons are listed in `coverage.gaps`, and `coverage.start` says when tracking begins.

> [!IMPORTANT] Missing is not zero
> Income before `coverage.start`, or in a gap, is **not attributed**. It is not counted as zero, and the API says so.

## Reconciliation

A completed replay must end at the **exact raw balance** of every token account on chain. Any mismatch marks the position partial, lists the mismatch, and disables conversion. Nothing is adjusted to fit.

## Yield is claimed only over full coverage

`GET /v1/yield` reports share yield for the trailing 30 days, the trailing 365 days and the tracked period. A figure is claimed only when:

- the position is `complete`, and
- its coverage spans the whole window.

Otherwise `shareYield` is `null`, with a coded `excluded` reason. Observed income and quantities for the covered part are still reported.

| `excluded.code` | Why |
|---|---|
| `position_incomplete` | The position has gaps or an unreplayable start |
| `coverage_after_window_start` | History begins inside the window |
| `no_holdings` | Nothing was held during the window |
| `missing_net_cash` | A distribution lacks issuer net cash (trailing distribution only) |

See [Yield metrics](/docs/guides/yield).
