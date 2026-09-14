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

All response types are exported, for example `import type { IncomeEntry, Position } from '@corpact/client'`.

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
