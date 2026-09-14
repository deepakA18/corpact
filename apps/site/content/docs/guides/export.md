---
title: Export to CSV
description: Accountant-ready exports of the journal or current income.
---

## Two datasets

| `dataset` | Contains | Use it for |
|---|---|---|
| `journal` (default) | Every recognition and reversal, in append order | Accounting and audit: nothing is ever edited |
| `income` | Current income entries, with revisions | A current view of what a wallet earned |

```bash
curl -s "http://127.0.0.1:4600/v1/export?owner=$WALLET&dataset=journal" \
  -H "authorization: Bearer $CORPACT_API_KEY" -o journal.csv
```

```ts
const csv = await corpact.exportCsv(wallet, 'income');
```

## Format

- **CSV.** RFC 4180 with CRLF line endings, UTF-8, served as an attachment (`corpact-journal-<wallet>-<date>.csv`).
- **Dataset column.** The first column is `dataset` (`mainnet` or `synthetic`), and synthetic files are named `corpact-SYNTHETIC-…`.
- **Exact and rounded values.** `quantity` and `usd` are exact decimals; `quantity_display` and `usd_rounded` are rounded for spreadsheets.
- **Unknown values.** An unknown USD is an **empty cell**, never `0`.
- **Confidence fields.** Every row carries `position_status`, `position_reconciled` and `coverage_start`.
- **Formula safety.** Text that a spreadsheet would evaluate as a formula is prefixed with an apostrophe.

Exports are capped at 50,000 rows and answer `422` beyond that. Page through `/v1/journal` or `/v1/income` instead.

> [!TIP] Browser downloads
> From a browser, link to your own server route that adds the key (the reference dashboard proxies `/v1/export`). `corpact.exportUrl(wallet, dataset)` builds the path.
