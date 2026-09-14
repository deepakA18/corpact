---
title: Corrections & the journal
description: How issuer revisions change income without rewriting history.
---

## Issuers revise their records

Corporate actions have versions. An issuer may correct withholding, net cash or even the action type after the fact: STRCx event `c5721924` went through several revisions. Late records also arrive: a change that was unattributed yesterday can match an action published today.

Corpact re-classifies whenever issuer evidence changes. It never edits what it already recognized.

## The journal

`GET /v1/journal` is an append-only audit trail. Every row is either a `recognition` or a `reversal`:

| Field | |
|---|---|
| `id` | Increasing row id |
| `recordedAt` | When Corpact recorded the row |
| `entryType` | `recognition` or `reversal` |
| `kind` | `dividend`, `split` or `unclassified_adjustment` |
| `effectiveAt`, `quantity`, `splitFactor`, `usd`, `valuation` | The values recognized, or reversed |
| `issuerEventId`, `issuerRevision` | The issuer evidence behind it |
| `reversesId` | For a reversal, the recognition it closes |
| `changeReason` | `initial`, `issuer_correction`, `balance_history_changed`, `valuation_changed`, `no_longer_applicable` |
| `changeDetail` | A human-readable description of what changed |

## A correction, step by step

The issuer publishes revision 2 of a dividend: withholding 34% instead of 30%, net $0.33 instead of $0.35 per share.

| Row | Entry | Kind | USD | Issuer revision | Reason |
|---|---|---|---|---|---|
| #1 | recognition | dividend | $35.00 | 1 | `initial` |
| #3 | reversal of #1 | dividend | $35.00 | 1 | `issuer_correction` |
| #4 | recognition | dividend | $33.00 | 2 | `issuer_correction` |

- **Row #1 stays.** Anyone who exported the journal before the correction can reconcile against it.
- **The income entry now reads $33.00,** with `revision: 2` and `correctedAt` set.
- **Conversion is paused** for the position for 7 days, so the revised income can be reviewed.

## Guarantees

- **Append-only storage.** The database refuses updates and deletes on the journal.
- **One open recognition.** Each entry has exactly one unreversed recognition, and a reversal always closes an earlier recognition of the same entry.
- **Journal equals income.** Open dividend recognitions equal the income the API publishes, and `verify-integrity` checks it.
- **Idempotent replay.** Re-running a sync with no new evidence appends nothing.

> [!TIP] Accounting integrations
> Consume the journal, not the income list. Book each row as it appears, and a correction arrives as ordinary entries, never as a changed number.
