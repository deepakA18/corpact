# Monitoring runbook

Corpact's worker records its health in Postgres. The API reads it back and grades it against PLAN §14 thresholds. No separate agent is needed.

## Where to look

| Surface | Access | Use |
| --- | --- | --- |
| `GET /v1/ops/status` | API key with `ops:read` | JSON: overall status plus one entry per check |
| `GET /v1/ops/metrics` | API key with `ops:read` | Prometheus text 0.0.4; scrape with the key as a bearer token |
| `pnpm cli check` (in `apps/worker`) | Database access | Same checks from the shell; exits 1 when any check is critical (cron, CI smoke test) |

`ops:read` grants no ledger access, and ledger keys cannot read ops. Create a dedicated key:

```bash
cd apps/api && pnpm keys create monitoring --tenant <slug> --scopes ops:read
```

## What feeds the checks

- **`worker_heartbeats`**: every `run` process upserts a row every 15 s, on a timer so a long backfill still counts as alive. The row carries that process's RPC request, retry and failure counters, as the infrastructure budget. Only the RPC host is stored, never the URL.
- **`sync_cursors` stream `mint-poll`**: written after each chain-only mint poll, with wall time, the finalized clock and the slot.
- **`provider_checks`**: the latest outcome of each balance and mint-state cross-check against the independent reconciliation provider. The heartbeat carries that provider's host, so monitoring knows whether one is configured ([ADR-0004](../adr/0004-independent-reconciliation-provider.md)).
- **Ledger tables**: `multiplier_versions`, `jobs_outbox`, `position_epochs`, `wallet_syncs`, `corporate_actions`.

Data integrity is checked separately, read-only and on demand, with `pnpm cli verify-integrity` in `apps/worker`. It runs after every restore; see the [backup and restore runbook](backup-restore.md).

## Checks

| Check | Critical / warn when | Default threshold | First response |
| --- | --- | --- | --- |
| `worker_heartbeat` | critical: no worker seen recently | 120 s | Is `pnpm start` running? Check for crash logs and database connectivity |
| `mint_poll_freshness` | critical: mint state not polled recently | max(180 s, 3 × poll interval) | Worker alive but polling stalled: look for a job stuck on RPC retries |
| `chain_clock_lag` | critical: finalized clock behind wall time at last poll | 120 s | RPC provider stale; switch `SOLANA_RPC_URL` or check the provider status |
| `overdue_activations` | critical: a scheduled multiplier change is past due and unsettled | 300 s grace | Look for a failing `rebuild_timeline` job for that mint; its income is withheld until it settles |
| `job_queue_draining` | critical: pending jobs waiting too long | 1800 s | Worker down or saturated; see `jobs_outbox` by kind |
| `failed_jobs_24h` | warn: jobs exhausted retries | 0 | `SELECT kind, business_key, last_error FROM jobs_outbox WHERE status = 'failed'` |
| `balance_reconciliation` | critical: a fully replayed position differs from chain | 0 | Conversion is already disabled for it. Treat as a ledger bug: compare `reconciliation_checks` against chain |
| `provider_agreement` | critical: a balance or mint-state check currently disagrees with the independent provider. warn: no independent provider configured, or no check within 2 h | 0 disagreements | Conversion is already paused for affected positions. Compare `provider_checks.details` with a third source before trusting either provider; switch `SOLANA_RPC_URL` if the primary is the wrong one |
| `failed_wallet_syncs` | warn | 0 | `wallet_syncs.error`; re-request the sync |
| `timeline_gaps` | warn: a mint's multiplier history has gaps | 0 | Usually RPC history limits; affected positions are already partial |
| `partial_positions` | informational | none | Shown to users; no action |
| `issuer_feed` | warn: nothing loaded, or live data stale | 2 days when live | With `ISSUER_SOURCE=fixtures` this reports ok by design. Never "fix" it by scheduling live issuer reads |

Thresholds live in `DEFAULT_THRESHOLDS` ([packages/db/src/monitoring.ts](../../packages/db/src/monitoring.ts)).

## Prometheus

```yaml
scrape_configs:
  - job_name: corpact
    metrics_path: /v1/ops/metrics
    authorization: { type: Bearer, credentials_file: /etc/corpact/ops-key }
    static_configs: [{ targets: ['api.internal:4600'] }]
```

Alert on `corpact_check_status == 2`. Budget dashboards come from `rate(corpact_rpc_requests_total[1h])` and the retry and failure counters, which reset when a worker restarts.
