---
title: Quickstart
description: Run the worker and API, create a key, and sync your first wallet.
---

This guide syncs a **real wallet** against mainnet, and takes about 15 minutes.

> [!TIP] Want to see responses first?
> [Try the API](/docs/try-it) runs live requests from your browser with no setup, and [Running the demo](/docs/operations/demo) does the whole flow locally in one command.

## Requirements

- Node 24 and pnpm 10
- Docker, for Postgres
- A Solana RPC endpoint with archival history. Public mainnet works but is slow; a provider key is recommended.

## Steps

<div class="steps">

<div class="step-block" data-step="1">

### Install and start Postgres

```bash
git clone <your corpact checkout> && cd corpact
pnpm install
cp .env.example .env     # set SOLANA_RPC_URL
docker compose up -d     # Postgres on 127.0.0.1:54329
```

> [!WARNING] Keep keys out of the browser
> `SOLANA_RPC_URL` often embeds a provider API key. The worker logs only the host. Never put it in a `NEXT_PUBLIC_*` variable.

</div>

<div class="step-block" data-step="2">

### Prepare the ledger

```bash
cd apps/worker
pnpm cli migrate
pnpm cli sync-registry           # verify mints on chain
pnpm cli import-issuer-actions   # actions from fixtures
pnpm start                       # job queue + mint polling
```

</div>

<div class="step-block" data-step="3">

### Create a tenant and an API key

```bash
cd apps/api
pnpm tenants create demo "My integration"
pnpm keys create backend --tenant demo \
  --scopes assets:read,ledger:read,wallets:sync
PORT=4600 pnpm start
```

The key is printed **once**. Only its SHA-256 is stored.

</div>

<div class="step-block" data-step="4">

### Sync a wallet

Registering a wallet adds it to your tenant and queues a historical sync.

<div class="code-tabs">
<div class="code-tab" data-label="curl">

```bash
export CORPACT_API_KEY=cpk_…
curl -s -X POST http://127.0.0.1:4600/v1/wallets/sync \
  -H "authorization: Bearer $CORPACT_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"owner":"6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U"}'
```

</div>
<div class="code-tab" data-label="TypeScript">

```ts
import { createCorpactClient } from '@corpact/client';

const corpact = createCorpactClient({ baseUrl: 'http://127.0.0.1:4600', apiKey: process.env.CORPACT_API_KEY });

await corpact.requestSync('6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U');
```

</div>
<div class="code-tab" data-label="Response">

```json
{ "owner": "6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U", "registration": "registered", "status": "queued", "job": "enqueued" }
```

</div>
</div>

A first sync replays the wallet's whole archival history, so it can take several minutes. Poll its status until it reads `complete` or `partial`:

```bash
curl -s http://127.0.0.1:4600/v1/wallets/6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U/status \
  -H "authorization: Bearer $CORPACT_API_KEY"
```

</div>

<div class="step-block" data-step="5">

### Read the ledger

<div class="code-tabs">
<div class="code-tab" data-label="Corporate actions (v2)">

```ts
const { actions } = await corpact.v2.actions(wallet);

for (const a of actions) {
  console.log(a.type, a.treatment, a.quantityDisplay, a.usd ?? 'USD unknown', a.lifecycle.state);
}
```

</div>
<div class="code-tab" data-label="Positions and income (v1)">

```ts
const portfolio = await corpact.portfolio(wallet);
const { entries } = await corpact.income(wallet);

for (const p of portfolio.positions) {
  console.log(p.symbol, p.status, p.quantity, 'floor', p.protectedQuantity, 'income', p.dividendIncomeUsd);
}
```

</div>
<div class="code-tab" data-label="curl">

```bash
curl -s "http://127.0.0.1:4600/v2/actions?owner=$WALLET" \
  -H "authorization: Bearer $CORPACT_API_KEY"
```

</div>
</div>

</div>

</div>

## Next

<div class="card-grid">
<a class="doc-link-card" href="/docs/guides/read-income"><span class="card-title">Read income</span><p>Entries, headlines and what a null USD value means.</p></a>
<a class="doc-link-card" href="/docs/concepts/coverage"><span class="card-title">Coverage & partial history</span><p>Why some positions are partial, and what is withheld.</p></a>
<a class="doc-link-card" href="/docs/api-reference"><span class="card-title">API reference</span><p>Every endpoint, parameter and response.</p></a>
</div>
