---
title: TypeScript client
description: '@corpact/client: typed access to every endpoint.'
---

## Install

`@corpact/client` is a workspace package, generated from the same JSON schemas as the API and the OpenAPI document. It is not yet published to npm.

```json
{ "dependencies": { "@corpact/client": "workspace:*" } }
```

## Create a client

```ts
import { createCorpactClient, CorpactApiError } from '@corpact/client';

const corpact = createCorpactClient({
  baseUrl: 'https://api.corpact.example', // or a same-origin path such as '/api/corpact' behind your own proxy
  apiKey: process.env.CORPACT_API_KEY,     // server-side only
});
```

| Option | |
|---|---|
| `baseUrl` | API origin, or a same-origin path when a server proxy holds the key |
| `apiKey` | Sent as `Authorization: Bearer` |
| `fetch` | Optional custom fetch |

## Methods

| Method | Endpoint | Returns |
|---|---|---|
| `health()` | `GET /v1/health` | `HealthResponse` |
| `assets()` | `GET /v1/assets` | `AssetsResponse` |
| `requestSync(wallet)` | `POST /v1/wallets/sync` | `SyncRequestResponse` |
| `wallets()` | `GET /v1/wallets` | `WalletsResponse` |
| `syncStatus(wallet)` | `GET /v1/wallets/{owner}/status` | `SyncStatusResponse` |
| `portfolio(wallet)` | `GET /v1/portfolio` | `Portfolio` |
| `income(wallet, { limit, offset })` | `GET /v1/income` | `IncomeResponse` |
| `incomeEvent(wallet, id)` | `GET /v1/income/{id}` | `IncomeDetail` |
| `journal(wallet, { limit, offset })` | `GET /v1/journal` | `JournalResponse` |
| `yieldMetrics(wallet)` | `GET /v1/yield` | `YieldResponse` |
| `exportCsv(wallet, dataset)` | `GET /v1/export` | CSV text |
| `exportUrl(wallet, dataset)` | None | URL string, for links behind a proxy |
| `opsStatus()` | `GET /v1/ops/status` | `OpsStatusResponse` |
| `opsMetrics()` | `GET /v1/ops/metrics` | Prometheus text |

### Corporate actions (v2)

| Method | Endpoint | Returns |
|---|---|---|
| `v2.actions(wallet, { limit, offset })` | `GET /v2/actions` | `ActionsResponse` |
| `v2.action(wallet, id)` | `GET /v2/actions/{id}` | `ActionDetail` |
| `v2.taxonomy()` | `GET /v2/taxonomy` | `TaxonomyResponse` |
| `v2.lineage(mint)` | `GET /v2/instruments/{mint}/lineage` | `LineageResponse` |

```ts
const { actions } = await corpact.v2.actions(wallet);

for (const a of actions) {
  // type: cash_dividend, spin_off, stock_dividend, identity_change, …
  // treatment: income, quantity_basis, basis_allocation, identity, not_booked
  console.log(a.type, a.treatment, a.quantityDisplay, a.usd ?? 'USD unknown', a.lifecycle.state);
}

// Full evidence for one action: lifecycle steps, six timestamps, every issuer revision, lineage.
const detail = await corpact.v2.action(wallet, actions[0]!.id);
```

All response types are exported, for example `import type { Action, ActionDetail, IncomeEntry, Position } from '@corpact/client'`.

> [!TIP] v1 or v2?
> v1 (`income`, `portfolio`, `journal`) stays supported and unchanged. v2 adds the action type, its lifecycle and its evidence. See [API v1 → v2](/docs/reference/api-v1-to-v2).

## Errors

A non-2xx response throws `CorpactApiError` with `status`, `message` and the parsed `body`:

```ts
try {
  await corpact.portfolio(wallet);
} catch (error) {
  if (error instanceof CorpactApiError && error.status === 404 && (error.body as { code?: string }).code === 'wallet_not_registered') {
    await corpact.requestSync(wallet);
  } else {
    throw error;
  }
}
```

## Schemas

The raw JSON schemas are exported as `schemas`, for your own validation:

```ts
import { schemas } from '@corpact/client';
```
