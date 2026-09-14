---
title: Explain an event
description: "The evidence behind one income entry: chain write, classification, issuer record and history."
---

## Request

```ts
const detail = await corpact.incomeEvent(wallet, entry.id);
```

The detail carries everything in the income entry, plus `history` and `evidence`. It is the answer to "why does my balance say this?"

## Chain evidence

```json
"chain": {
  "updateSignature": "2reEfzuS6mm…",
  "explorerUrl": "https://explorer.solana.com/tx/2reEfzuS6mm…",
  "observedSlot": "400000000",
  "instructionPath": [1],
  "scheduledAt": "2026-06-14T23:55:00.000Z",
  "effectiveAt": "2026-06-14T23:55:00.000Z",
  "immediate": false,
  "status": "active",
  "multiplierBefore": { "bits": "…", "exact": "1.0137794826729940" },
  "multiplierAfter": { "bits": "…", "exact": "1.0183317967386898" }
}
```

| Field | Meaning |
|---|---|
| `updateSignature`, `instructionPath` | The transaction and instruction that wrote the multiplier |
| `scheduledAt` / `effectiveAt` | When it was scheduled, and when it took effect. They differ for a late publication (`immediate: true`) |
| `status` | `active`, `superseded`, `scheduled` or `orphaned` (starting multiplier never observed) |
| `multiplierBefore` / `multiplierAfter` | The exact f64 bytes (`bits`) and their exact decimal value |

## Classification

```json
"classification": {
  "result": "dividend",
  "classifierVersion": "classify-v2",
  "issuerEventId": "ee3e95e7-4509-499c-a090-4f5c91438ea5",
  "issuerRevision": 2,
  "netCashPerShare": "0.371",
  "reasons": [],
  "warnings": []
}
```

`result` is `dividend`, `split`, `unclassified` or `pending`. v1 reports spin-offs, rights, stock dividends and identity changes as `unclassified`, with the treatment in `reasons` (for example `Spin-off booked as a basis allocation, not income: 48.75% of the position's value was distributed and reinvested`). For a qualified dividend, `warnings` says what was withheld (for example an implausible implied price). For the action type itself, its lifecycle and every issuer revision, use `GET /v2/actions/{id}` (see [API v1 → v2](/docs/reference/api-v1-to-v2)).

## Issuer record

```json
"issuerRecord": { "source": "fixtures", "evidenceSha256": "ab12…", "record": { "eventId": "ee3e95e7-…", "type": "CashDividend", "…": "…" } }
```

This is the exact issuer record the match used, with its source and the hash of the stored evidence. It is `null` when no issuer action matched.

## History

`history` lists every journal row for this entry, oldest first: the initial recognition, and any reversal and replacement caused by a correction. See [Corrections & the journal](/docs/concepts/corrections).

> [!TIP] Put it in front of users
> The reference dashboard opens this detail in a drawer from each income row, with the headline, the multipliers, a link to the transaction, and the correction history.
