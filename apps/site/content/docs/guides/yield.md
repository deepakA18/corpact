---
title: Yield metrics
description: Share yield and trailing distributions, without a price source, and never over partial history.
---

## Request

```ts
const metrics = await corpact.yieldMetrics(wallet);
```

Each position reports up to three windows (`trailing_30d`, `trailing_365d` and `tracked`), a trailing net distribution, and a distribution yield that stays unavailable until a price source exists.

## Share yield

```text
share yield = dividend-attributed shares gained ÷ time-weighted average shares held
```

Both are in the current split basis, so a split changes nothing. The figure is **not annualized** and **needs no price**: dividends arrive as reinvested shares, so this approximates net dividend yield at the prices the issuer reinvested at.

```json
{
  "window": "tracked",
  "partial": false,
  "coveredStart": "2025-10-23T17:04:27.000Z",
  "incomeUsd": "22.0774775216…",
  "valuedDividends": 3,
  "unvaluedDividends": 0,
  "dividendQuantity": "0.2586…",
  "averageQuantity": "20.14777578",
  "shareYield": "0.0128356724",
  "excluded": null
}
```

## When no figure is claimed

A window whose coverage starts late, or a position that is not `complete`, returns `shareYield: null` with a reason:

```json
{ "window": "trailing_365d", "partial": true, "shareYield": null, "excluded": { "code": "coverage_after_window_start", "message": "Coverage begins 2025-10-23T17:04:27.000Z, after this window starts; yield is claimed only over fully covered windows" } }
```

`incomeUsd`, `dividendQuantity` and `averageQuantity` still describe what was observed in the covered part.

> [!TIP] Rendering
> Show the trailing-year yield when it is claimed. Otherwise show the tracked-period yield, labelled with its start date. Otherwise show the `excluded.message`. That is what the demo view does.

## Trailing net distribution per share

This is the sum of issuer-verified net cash per share over the trailing 365 days, normalized to today's split basis. It is `null` when any distribution lacks issuer cash, or when the observed multiplier history starts inside the window.
