---
title: Backup & restore
description: What cannot be rebuilt, recovery targets, and a restore drill you can run.
---

## What cannot be rebuilt

| Data | If lost |
|---|---|
| `ledger_journal`, superseded `action_matches` | **Unrecoverable.** The audit trail of what was recognized, and when |
| `corporate_actions` | **Unrecoverable in practice.** Replaced issuer revisions may no longer be published |
| `tenants`, `api_keys`, `tenant_wallets` | **Unrecoverable.** Keys must be reissued |
| `provider_checks` | **Unrecoverable.** The record of source disagreements |
| Chain observations and movements | Rebuildable from an archival RPC, at cost |
| Positions, income entries, timelines | Rebuilt by the worker |

## Targets

- **RPO 5 minutes.** Continuous WAL archiving with point-in-time recovery.
- **RTO 1 hour.**
- **Daily logical dumps,** kept 35 days.
- **A restore drill** monthly, and before any migration that touches an append-only table.

## Verify a restored copy

```bash
DATABASE_URL=postgres://…/restored pnpm --filter @corpact/worker exec tsx src/main.ts verify-integrity
```

It checks, read-only:
- **Migrations:** every migration is applied, and no unknown one is.
- **Guards:** the append-only guards are enabled.
- **Hashes:** every chain observation and issuer record matches its stored hash.
- **Journal structure:** every reversal closes exactly one earlier recognition.
- **Journal against income:** open recognitions equal published income.

## The drill

```bash
tools/ops/restore-drill.sh
```

It dumps the database, restores it into a scratch database, bounds each append-only table's row count between before and after the dump, runs `verify-integrity` on the copy, and exits 1 if anything fails.

> [!WARNING] Backups hold wallet data
> Dumps contain wallet addresses and holdings history. Encrypt them and restrict access as tightly as the database itself.
