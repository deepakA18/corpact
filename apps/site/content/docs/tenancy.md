---
title: Tenants & wallets
description: How wallet access is isolated between customers.
---

## Tenants

A tenant is one customer of the API. Every key belongs to a tenant, and a tenant has a wallet quota.

```bash
pnpm tenants create <slug> <name> [--max-wallets N]
```

## Registering wallets

A key reads **only wallets its tenant has registered**. `POST /v1/wallets/sync` registers the wallet within the tenant's quota, then queues a sync:

```json
{ "owner": "6kn8…Cy1U", "registration": "registered", "status": "queued", "job": "enqueued" }
```

`registration` is `registered`, or `already_registered` on later calls. Beyond the quota the call answers `403` with code `wallet_quota_exceeded`.

`GET /v1/wallets` lists the tenant's wallets and quota.

## Isolation

Reading a wallet the tenant has not registered answers `404` with code `wallet_not_registered`, exactly as if it did not exist. One customer cannot learn which wallets another tracks.

> [!NOTE] Shared chain data
> Chain observations, the multiplier timeline and issuer evidence are shared across tenants; they are public facts. Only **access** to wallet ledgers is scoped.
