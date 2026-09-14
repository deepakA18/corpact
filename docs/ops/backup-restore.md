# Backup and restore runbook

Corpact's database is the evidence base for every published number. Some of it can be fetched again from the chain; some of it cannot be recovered by anyone. Backups exist for the second kind.

## What can and cannot be rebuilt

| Data | Tables | If lost |
|---|---|---|
| **Accounting history** | `ledger_journal`, `action_matches` (including superseded rows) | **Unrecoverable.** A re-sync recognizes today's interpretation again, but not what was recognized before a correction or when. The audit trail is gone. |
| **Issuer evidence** | `corporate_actions` | **Unrecoverable in practice.** Revisions the issuer has since replaced may no longer be published, and the live feed has no licence to re-fetch from. |
| **Customers** | `tenants`, `api_keys`, `tenant_wallets` | **Unrecoverable.** Keys would have to be reissued to every customer. |
| **Provider cross-checks** | `provider_checks` | **Unrecoverable.** It is the record of when sources disagreed. |
| **Chain evidence** | `chain_observations`, `address_signatures`, `multiplier_writes`, `balance_movements`, `transaction_indexes` | **Rebuildable** from an archival RPC, at provider cost and hours of sync ([ADR-0002](../adr/0002-archival-history-on-standard-json-rpc.md)). |
| **Derived state** | `multiplier_versions`, `position_epochs`, `income_entries`, `position_quantity_samples`, `sync_cursors`, `jobs_outbox`, `worker_heartbeats` | **Rebuilt** by the worker from the tables above. |

## Targets

**RPO: 5 minutes.** Continuous WAL archiving with point-in-time recovery.

**RTO: 1 hour.** The measured restore of today's database takes seconds; the budget covers provisioning and verification.

**Logical dumps.** Take one daily and keep them 35 days. They are the escape hatch from a broken physical backup chain and from a major-version upgrade.

**Restore drill.** Run it monthly, and before every migration that alters an append-only table (006 did).

## Production setup

- **Managed Postgres.** Enable point-in-time recovery with at least 7 days of retention, plus the daily logical dump to separate storage in a different account.
- **Self-hosted Postgres.** Run pgBackRest or WAL-G with `archive_mode = on`, weekly full and daily differential backups, and WAL shipped continuously to object storage with versioning and object lock.
- **Encryption and access.** Backups contain wallet addresses and each wallet's holdings history. Encrypt them at rest and restrict who can read them as tightly as the database itself. `backups/` is gitignored for this reason.
- **What `docker-compose.yml` provides.** Development only: no WAL archiving, no PITR.

## Restoring

1. **Stop the worker.** A worker writing into a half-restored database corrupts the drill as much as the restore.
2. **Restore.** Use PITR to just before the incident, or `pg_restore --exit-on-error --no-owner` into an empty database.
3. **Verify, and trust nothing until this passes.**

   ```bash
   DATABASE_URL=postgres://…/restored pnpm --filter @corpact/worker exec tsx src/main.ts verify-integrity
   ```

   It runs read-only and never migrates first. It checks:
   - **Migrations:** every migration in the code is applied, and nothing unknown is.
   - **Append-only guards:** enabled on all six evidence and journal tables.
   - **Evidence hashes:** every chain observation and issuer record still matches its `stored_payload_sha256`.
   - **Journal structure:** every reversal closes exactly one earlier recognition, and no entry has two open recognitions.
   - **Journal against income:** open dividend recognitions equal published income for every position.
4. **Point the API at it, then start the worker.** The worker re-syncs chain data after the restore point. Its journal appends are idempotent. A recognition lost in the restore window is recognized again, with a new `recorded_at`, and that difference is why the RPO matters.
5. **Record the incident window.** Customers exporting the journal for that period should re-export.

## Evidence hashes

`payload_sha256` and `evidence_sha256` hash the JSON text as first serialized. `jsonb` keeps the value but not that text (it reorders keys), so those hashes cannot be recomputed from the database, from a dump, or after a restore.

Migration 006 added `stored_payload_sha256`, a hash of Postgres' own rendering of the stored `jsonb`, which survives dump and restore. New rows are hashed on insert. Rows that existed at migration 006 were sealed then, and `hash_sealed_at_ingestion = false` marks them: the hash proves they have not changed since that migration, not since ingestion.

## The drill

```bash
tools/ops/restore-drill.sh        # KEEP_DRILL_DB=1 keeps corpact_restore_drill for inspection
```

The drill runs five steps:
1. Dumps the ledger database (custom format) into `backups/` and prints its SHA-256.
2. Restores the dump into `corpact_restore_drill`.
3. Requires each append-only table in the copy to hold between the row counts taken before and after the dump. The worker may keep writing meanwhile.
4. Runs `verify-integrity` on the copy, from a clean environment with no repo `.env`.
5. Drops the drill database. It exits 1 if any step fails.

### Last run: 2026-09-14, local development database

| Step | Result |
|---|---|
| Dump | 31 MB in 3 s |
| Restore | 3 s |
| Row counts | exact for all six tables: 32,811 chain observations, 1,340 multiplier writes, 1,233 corporate actions, 34,647 balance movements, 10 journal rows, 0 provider checks |
| `verify-integrity` on the copy | 6/6 passed |
| End to end | 7 s |

Production restore time will be dominated by data volume and provisioning. Re-measure it against production-sized data before relying on the RTO.
