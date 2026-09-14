---
title: Errors & limits
description: Status codes, machine-readable error codes and limits.
---

## Error body

Errors return JSON with a human-readable `error`, and a `code` when a client should branch on it:

```json
{ "error": "This wallet is not registered for your tenant; request a sync to register it", "code": "wallet_not_registered" }
```

## Status codes

| Status | `code` | When |
|---|---|---|
| `400` | None | Invalid input: a malformed address, a limit out of range, an unknown dataset |
| `401` | None | Missing, invalid or revoked API key |
| `403` | `missing_scope` | The key lacks the route's scope |
| `403` | `wallet_quota_exceeded` | Registering a wallet beyond the tenant's quota |
| `404` | `wallet_not_registered` | The wallet is not registered to your tenant, or does not exist |
| `422` | None | An export exceeds 50,000 rows |
| `429` | None | Rate limit exceeded, or too many failed key attempts; honour `retry-after` |
| `500` | None | Internal error; the body says only `Internal error` |

## Limits

| Limit | Default | Setting |
|---|---|---|
| Requests per key per minute | 120 | `RATE_LIMIT_PER_MINUTE` |
| Failed key attempts per address per minute | 20 | `AUTH_FAILURES_PER_MINUTE` |
| Page size (`limit`) | up to 200 | per request |
| Export rows | 50,000 | fixed |
| Wallets per tenant | set per tenant | `--max-wallets` |

Every response carries `cache-control: no-store` and `x-corpact-dataset`.
