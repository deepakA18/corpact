# Corpact

**Corporate-action accounting for tokenized equities on Solana.**

Tokenized stocks such as xStocks pay dividends, split and spin off by rewriting a balance multiplier on the mint. No cash and no transfer is involved. Read naively, that data gives confidently wrong numbers. A spin-off books as ~95% income, a split looks like a windfall, and an issuer cash figure that doesn't reconcile becomes revenue.

Corpact turns those multiplier changes into evidence-backed accounting, which exchanges, collateral protocols, portfolio trackers and tax tools can build on:

- **Timeline:** every multiplier change for a mint, rebuilt from chain data and verified against live mint state.
- **Classification:** dividend, split or unclassified, matched to the issuer's corporate-action record, with the reason kept for every result.
- **Ledger:** dividend quantity and USD value per position, a protected-principal floor, the amount convertible now, and exact reconciliation against on-chain balances.
- **Coverage:** where history is complete, partial or unsupported. It never guesses, and never reports unknown as zero.

> **Status: pre-validation.** The engine is built and tested against real mainnet data. Commercial use of the issuer's corporate-action feed is not yet licensed, and the regulatory review is pending. See [phase0-validation.md](docs/findings/phase0-validation.md) and [counsel-questions-api.md](docs/findings/counsel-questions-api.md).

## Packages

| Package | What it does |
|---|---|
| `@corpact/domain` | Exact `Rational` arithmetic, units, corporate-action types |
| `@corpact/accounting` | Evidence classifier and protected-floor ledger reducer (pure, deterministic) |
| `@corpact/solana` | Token-2022 mint decoding, the multiplier timeline (mirrors the program's processor), the transaction parser, a kit-based chain reader |
| `@corpact/issuers` | Issuer adapters behind `IssuerSource`: recorded fixtures (default) or live |
| `@corpact/db` | Postgres schema, migrations, outbox, immutable observations |
| `@corpact/client` | API contract (JSON schemas → OpenAPI and TypeScript types) and a typed fetch client |
| `apps/worker` | Registry verification, archival ingestion, timeline, classification, position rebuild |
| `apps/api` | Read-only HTTP API over the ledger |
| `apps/web` | Reference dashboard: a demo of the API, not the product |

Design decisions are in [docs/adr/](docs/adr/), and the original product plan is [PLAN.md](PLAN.md).

## Run it

Requires Node 24, pnpm 10, Docker, and an archival Solana RPC. Public mainnet works but is very slow; see [ADR-0002](docs/adr/0002-archival-history-on-standard-json-rpc.md).

```bash
pnpm install
cp .env.example .env                         # set SOLANA_RPC_URL (an API-key URL stays server-side)
docker compose up -d                         # Postgres on 127.0.0.1:54329

cd apps/worker
pnpm cli migrate
pnpm cli sync-registry                       # verify every recorded xStock mint on mainnet
pnpm cli import-issuer-actions               # corporate actions from fixtures (no network)
pnpm start                                   # worker: job queue + chain-only mint polling

cd ../api
pnpm keys create demo-dashboard              # prints the key once; only its hash is stored
PORT=4600 pnpm start

cd ../web
# apps/web/.env.local (gitignored):
#   CORPACT_API_URL=http://127.0.0.1:4600
#   CORPACT_API_KEY=cpk_...
pnpm dev --port 3600
```

Checks: `pnpm test` and `pnpm typecheck` from the root, plus `pnpm --filter @corpact/api openapi:check`. CI runs all three, and applies the migrations twice against a fresh Postgres. To sync a wallet without the web app, run `pnpm cli sync-wallet <address>` in `apps/worker`.

## API access

- **Keys.** Every route except `/v1/health` and `/v1/openapi.json` needs `Authorization: Bearer <key>`. Keys are issued with `pnpm keys create <name>`, listed with `pnpm keys list` and revoked with `pnpm keys revoke <id>`, all in `apps/api`. Only a SHA-256 of each key is stored.
- **Limits.** Each key is allowed `RATE_LIMIT_PER_MINUTE` requests per minute (default 120), with `429` and `retry-after` beyond that. After `AUTH_FAILURES_PER_MINUTE` failed key attempts (default 20), further attempts from that address are refused for the minute. Limits are held in memory per API instance.
- **Contract.** The OpenAPI 3.1 document is served at `/v1/openapi.json` and committed at [packages/client/openapi.json](packages/client/openapi.json). The API, that document and the `@corpact/client` types all come from one set of schemas, and a contract test checks real responses against them.
- **Client.**

  ```ts
  import { createCorpactClient } from '@corpact/client';

  const corpact = createCorpactClient({ baseUrl: 'https://api.example', apiKey: process.env.CORPACT_API_KEY });
  const { positions, coverage } = await corpact.portfolio('6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U');
  ```

- **Browsers never hold keys.** The demo dashboard calls its own server route (`/api/corpact/*`), which attaches the key and forwards only the routes it needs.

## The issuer-data constraint

The xStocks corporate-action feed has no commercial licence, and the website terms prohibit automated retrieval.

- **Every issuer read goes through `IssuerSource`.** `ISSUER_SOURCE=fixtures` is the default and makes no network calls. `live` is the only switch.
- **No scheduled job reads the issuer.** `import-issuer-actions` is a one-shot command; the worker loop polls **chain state only**.
- **These scripts call `api.xstocks.fi` live:** `tools/record-fixtures.mjs` and the Phase 0 scripts in `tools/validate/`. Do not run them until licensing is resolved.

## What the numbers promise

- Income comes only from issuer-reported net cash that reconciles with the shares delivered. There is no event-time price source yet. A dividend without trustworthy issuer cash keeps its quantity, with USD shown as unknown.
- Every position carries `coverageStart`, gaps and reconciliation status. Anything that cannot be replayed from verified chain history is partial or unsupported, never zero.
- The convertible amount appears only when replay completed. Conversion itself is not built.
