---
title: Read income
description: Income entries, what each field means, and how to show unknown values honestly.
---

## List entries

```ts
const { entries, nextOffset } = await corpact.income(wallet, { limit: 50 });
```

Entries are newest first. Page with `offset` until `nextOffset` is `null`.

```json
{
  "id": "10",
  "mint": "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ",
  "symbol": "KOx",
  "kind": "dividend",
  "effectiveAt": "2026-06-14T23:55:00.000Z",
  "quantity": "0.09059763073",
  "quantityDisplay": "0.09059763",
  "splitFactor": null,
  "usd": "7.4851762504",
  "valuation": "issuer_net_cash",
  "warnings": [],
  "reasons": [],
  "headline": "Your KOx position gained 0.09059763 stock-equivalent units from a verified dividend adjustment. Value from issuer-reported net cash reinvested: $7.49. This remains invested in the stock.",
  "revision": 1,
  "correctedAt": null
}
```

## Fields

| Field | Meaning |
|---|---|
| `kind` | `dividend` (verified), `split`, or `unclassified_adjustment` (a change not attributed to income) |
| `effectiveAt` | When the change took effect on chain; for a late publication, the publication time |
| `quantity` | Exact stock-equivalent units added, as a decimal |
| `quantityDisplay` | Rounded toward zero at the mint's decimals |
| `splitFactor` | For splits, e.g. `"2"` for 2-for-1 |
| `usd` | Value from issuer evidence, or `null` when unknown |
| `valuation` | How `usd` was derived, e.g. `issuer_net_cash` |
| `warnings` | Why a dividend's value is qualified or withheld |
| `reasons` | Why a change is not attributed to income |
| `headline` | A plain-language sentence you can show a holder |
| `revision`, `correctedAt` | Greater than 1 when issuer evidence changed the interpretation |

## Showing values honestly

- **`usd: null` is unknown, not zero.** Show "value unknown" and the first warning. Never sum it as `0`; positions report `unvaluedDividendEvents` separately.
- **Splits have no USD value.** Show the factor.
- **Unclassified adjustments are not income.** Show them as "classification pending", with `reasons[0]`.
- **Income is retained in stock.** A dividend arrives as extra units, not cash. Say so; the `headline` does.

> [!NOTE] Totals
> `GET /v1/portfolio` returns `dividendIncomeUsd` per position and in `totals`. It sums **valued** dividends only, and reports the rest in `unvaluedDividendEvents`.
