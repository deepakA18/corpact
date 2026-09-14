---
title: Quickstart
description: Run the worker and API, create a key, and sync your first wallet.
---

## Requirements

- Node 24 and pnpm 10
- Docker, for Postgres
- A Solana RPC endpoint with archival history. Public mainnet works but is slow; a provider key is recommended.

## 1. Install and start Postgres

```bash
git clone <your corpact checkout> && cd corpact
pnpm install
cp .env.example .env        # set SOLANA_RPC_URL; the URL stays server-side
docker compose up -d        # Postgres on 127.0.0.1:54329
```

> [!WARNING] Keep keys out of the browser
> `SOLANA_RPC_URL` often embeds a provider API key. The worker logs only the host. Never put it in a `NEXT_PUBLIC_*` variable.

## 2. Prepare the ledger

```bash
cd apps/worker
pnpm cli migrate
pnpm cli sync-registry           # verify every supported mint on chain
pnpm cli import-issuer-actions   # corporate actions from recorded fixtures (no network)
pnpm start                       # the worker: job queue + chain-only mint polling
```

## 3. Create a tenant and an API key

```bash
cd apps/api
pnpm tenants create demo "My integration"
pnpm keys create backend --tenant demo --scopes assets:read,ledger:read,wallets:sync
PORT=4600 pnpm start
```

The key is printed **once**. Only its SHA-256 is stored.

## 4. Sync a wallet

```bash
export CORPACT_API_KEY=cpk_…
curl -s -X POST http://127.0.0.1:4600/v1/wallets/sync \
  -H "authorization: Bearer $CORPACT_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"owner":"6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U"}'
```

```json
{ "owner": "6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U", "registration": "registered", "status": "queued", "job": "enqueued" }
```

Syncing registers the wallet to your tenant and queues a historical sync. Poll its status until it is `complete` or `partial`:

```bash
curl -s http://127.0.0.1:4600/v1/wallets/6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U/status \
  -H "authorization: Bearer $CORPACT_API_KEY"
```

## 5. Read the ledger

```ts
import { createCorpactClient } from '@corpact/client';

const corpact = createCorpactClient({ baseUrl: 'http://127.0.0.1:4600', apiKey: process.env.CORPACT_API_KEY });
const wallet = '6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U';

const portfolio = await corpact.portfolio(wallet);
const { entries } = await corpact.income(wallet);

for (const p of portfolio.positions) {
  console.log(p.symbol, p.status, p.quantity, 'floor', p.protectedQuantity, 'income', p.dividendIncomeUsd);
}
```

> [!TIP] No wallet handy?
> [Running the demo](/docs/operations/demo) does all of this on a local network with synthetic assets, and prints a walkthrough.

## Next

- [Read income](/docs/guides/read-income): entries, headlines and what `usd: null` means
- [Coverage & partial history](/docs/concepts/coverage): why some positions are `partial`
- [API reference](/docs/api-reference)
