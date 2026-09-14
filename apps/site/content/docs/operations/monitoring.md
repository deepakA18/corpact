---
title: Monitoring
description: Health checks, Prometheus metrics and what to do when a check fires.
---

## Where to look

| Surface | Access | Use |
|---|---|---|
| `GET /v1/ops/status` | Key with `ops:read` | JSON: overall status and one entry per check |
| `GET /v1/ops/metrics` | Key with `ops:read` | Prometheus text 0.0.4 |
| `pnpm cli check` in `apps/worker` | Database access | The same checks; exits 1 when any check is critical |

```bash
pnpm keys create monitoring --tenant <slug> --scopes ops:read
```

## Checks

| Check | Fires when | First response |
|---|---|---|
| `worker_heartbeat` | No worker seen for 120 s | Is the worker running? Check database connectivity |
| `mint_poll_freshness` | Mint state not polled recently | Look for a job stuck on RPC retries |
| `chain_clock_lag` | Finalized clock over 120 s behind wall time | The RPC provider is stale |
| `overdue_activations` | A scheduled change is 300 s past due and unsettled | Look for a failing `rebuild_timeline` job for that mint |
| `job_queue_draining` | Pending jobs waiting over 30 min | Worker down or saturated |
| `failed_jobs_24h` | Jobs exhausted retries | Read `jobs_outbox.last_error` |
| `balance_reconciliation` | A fully replayed position differs from chain | Conversion is already disabled; treat it as a ledger bug |
| `provider_agreement` | The independent RPC disagrees (critical), or none is configured (warn) | See [Independent RPC provider](/docs/operations/independent-provider) |
| `failed_wallet_syncs` | A wallet sync failed | Read `wallet_syncs.error` and re-request the sync |
| `timeline_gaps` | A mint's multiplier history has gaps | Affected positions are already partial |
| `issuer_feed` | Nothing loaded, or live data stale | With recorded fixtures this is ok by design |

## Prometheus

```yaml
scrape_configs:
  - job_name: corpact
    metrics_path: /v1/ops/metrics
    authorization: { type: Bearer, credentials_file: /etc/corpact/ops-key }
    static_configs: [{ targets: ['api.internal:4600'] }]
```

Alert on `corpact_check_status == 2`. The RPC budget comes from `corpact_rpc_requests_total`, and disagreements from `corpact_provider_disagreements`.
