---
title: Authentication
description: API keys, scopes and how requests are authorized.
---

## API keys

Every route except `/v1/health` and `/v1/openapi.json` needs an API key. Send it as a bearer token, or in the `x-api-key` header:

```bash
curl -s http://127.0.0.1:4600/v1/assets -H "authorization: Bearer $CORPACT_API_KEY"
curl -s http://127.0.0.1:4600/v1/assets -H "x-api-key: $CORPACT_API_KEY"
```

Keys look like `cpk_` followed by 43 URL-safe characters: 256 bits of entropy. Corpact stores only a SHA-256 of each key, so a lost key cannot be recovered, only revoked and replaced.

> [!WARNING] Server-side only
> Never ship an API key to a browser. The reference dashboard calls its own server route, which attaches the key and forwards only the routes it needs.

## Managing keys

Keys belong to a tenant and are managed from `apps/api`:

```bash
pnpm keys create <name> --tenant <slug> [--scopes assets:read,ledger:read]
pnpm keys list
pnpm keys revoke <id>
```

## Scopes

Each key holds a subset of four scopes. New keys default to read-only (`assets:read`, `ledger:read`).

| Scope | Grants |
|---|---|
| `assets:read` | `GET /v1/assets` |
| `ledger:read` | Portfolio, income, event detail, journal, yield, exports, wallet list and sync status |
| `wallets:sync` | `POST /v1/wallets/sync`: registers a wallet and queues a sync |
| `ops:read` | `GET /v1/ops/status` and `/v1/ops/metrics` only; no ledger access |

A request without the route's scope answers `403` with code `missing_scope`:

```json
{ "error": "This API key lacks the \"wallets:sync\" scope", "code": "missing_scope" }
```

## Limits

- **Rate limits.** Each key may make `RATE_LIMIT_PER_MINUTE` requests per minute (default 120). Beyond that it gets `429`, with a `retry-after` header.
- **Failed attempts.** After `AUTH_FAILURES_PER_MINUTE` failed key attempts from one address (default 20), further attempts from that address are refused for the minute, even with a valid key.
- **Scope of the limits.** They are held in memory per API instance.

See [Errors & limits](/docs/reference/errors) for every status code.
