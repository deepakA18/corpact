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
pnpm tenants create demo "Demo dashboard"
pnpm keys create dashboard --tenant demo --scopes assets:read,ledger:read,wallets:sync   # printed once
PORT=4600 pnpm start

cd ../web
# apps/web/.env.local (gitignored):
#   CORPACT_API_URL=http://127.0.0.1:4600
#   CORPACT_API_KEY=cpk_...
pnpm dev --port 3600
```

Checks: `pnpm test` and `pnpm typecheck` from the root, plus `pnpm --filter @corpact/api openapi:check`. CI runs all three, and applies the migrations twice against a fresh Postgres. To sync a wallet without the web app, run `pnpm cli sync-wallet <address>` in `apps/worker`.

**Website and docs.** `apps/site` is the homepage and developer documentation: guides, concepts, operations, and an API reference generated from the OpenAPI document. Run it with `pnpm --filter @corpact/site dev` at http://localhost:3700. Pages are Markdown files in `apps/site/content/docs`.

**Demo.** `pnpm --filter @corpact/demo demo` needs Surfpool 1.0 and takes about 4½ minutes. It runs three parts:

1. A narrated walkthrough on a local network: position, a dividend with no transfer, the entry, a split that isn't income, and an issuer correction.
2. The recorded HONx spin-off and STRCx implausible-cash cases, beside the naive reading.
3. The full synthetic trap regression suite.

Synthetic data is labelled in every API response, export and dashboard view. See [docs/demo.md](docs/demo.md). The one-page leave-behind is [docs/findings/what-this-catches.md](docs/findings/what-this-catches.md), regenerated with `pnpm --filter @corpact/demo catches`.

## API access

- **Keys.** Every route except `/v1/health` and `/v1/openapi.json` needs `Authorization: Bearer <key>`. Only a SHA-256 of each key is stored. In `apps/api`:
  - `pnpm tenants create <slug> <name> [--max-wallets N]`
  - `pnpm keys create <name> --tenant <slug> [--scopes …]`
  - `pnpm keys list`
  - `pnpm keys revoke <id>`
- **Scopes.** Each key holds a subset of `assets:read`, `ledger:read`, `wallets:sync` and `ops:read`, and new keys default to read-only (`assets:read`, `ledger:read`). `ops:read` covers only the monitoring routes. Calling a route without its scope returns `403 missing_scope`.
- **Tenancy.** A key reads only wallets its tenant has registered. `POST /v1/wallets/sync` registers a wallet within the tenant's quota (`403 wallet_quota_exceeded` beyond it). Any other wallet answers `404 wallet_not_registered`, so one customer cannot learn which wallets another tracks. `GET /v1/wallets` lists a tenant's wallets. The chain data itself is shared across tenants; only access is scoped.
- **Limits.** Each key is allowed `RATE_LIMIT_PER_MINUTE` requests per minute (default 120), with `429` and `retry-after` beyond that. After `AUTH_FAILURES_PER_MINUTE` failed key attempts (default 20), further attempts from that address are refused for the minute. Limits are held in memory per API instance.
- **Yield.** `GET /v1/yield?owner=` reports, per position, income and share yield for trailing 30 days, trailing 365 days and the tracked period. Share yield is dividend shares gained ÷ time-weighted shares held, in the current split basis, needs no price, and is not annualized. It also reports trailing net distribution per share from issuer-verified cash. Partial history is excluded from yield claims: a yield is given only for a completely replayed position over a window its coverage fully spans, and otherwise is null with a coded `excluded` reason, while the income and quantities observed in the covered part are still reported. Distribution yield stays null until a price source exists.
- **Export.** `GET /v1/export?owner=&dataset=journal|income` returns RFC 4180 CSV, capped at 50,000 rows. `journal` (the default) is the append-only recognition/reversal trail for accountants; `income` is current entries with revisions. Rows carry position status, reconciliation and coverage start, and unknown USD is an empty cell, never `0`.
- **Monitoring.** `GET /v1/ops/status` (JSON checks) and `GET /v1/ops/metrics` (Prometheus) need `ops:read`; `pnpm cli check` in `apps/worker` runs the same checks. See the [monitoring runbook](docs/ops/monitoring.md).
- **Independent provider.** Set `RECONCILIATION_RPC_URL` to a second RPC provider, and the worker cross-checks wallet balances and held mints' multiplier state against it. A disagreement pauses conversion for the affected positions and turns monitoring critical, without touching the ledger ([ADR-0004](docs/adr/0004-independent-reconciliation-provider.md)).
- **Backups.** `tools/ops/restore-drill.sh` dumps the database, restores it into a scratch database, bounds the row counts, and runs `pnpm cli verify-integrity` on the copy. That command checks stored evidence hashes, the append-only guards, and that the journal matches published income. See the [backup and restore runbook](docs/ops/backup-restore.md).
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
- Issuer corrections never rewrite history. A changed classification supersedes the old one, and changed income is journaled as a reversal plus a replacement. The audit trail is at `GET /v1/journal` ([ADR-0003](docs/adr/0003-issuer-corrections-are-journaled.md)).
