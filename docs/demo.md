# Synthetic demo: the Phase 0 traps, end to end

`apps/demo` runs the plan's demo script (PLAN §8) against a **local test validator** with **synthetic** assets. It walks through every trap Phase 0 found that the ledger can reproduce without a price source. Nothing is mocked: the worker, the classifier, the ledger reducer and the API all run unmodified. Every check reads its result through the public API, with a real tenant and key.

```bash
docker compose up -d                       # Postgres
pnpm --filter @corpact/demo demo           # ~3 minutes; exits 1 if any check fails
```

It needs `solana-test-validator` on `PATH` (Agave 4.x) and nothing listening on `127.0.0.1:8899`.

## What it does

1. **Starts a validator.** A fresh `solana-test-validator` runs, with its ledger under `apps/demo/out/<run>/`.
2. **Seeds the scenario with kit-built transactions.** Every key is generated per run. There are two Token-2022 mints with the ScaledUiAmount extension:
   - **DDIVx** is fully covered and walks through the traps.
   - **DPARx** is held before its first observable multiplier write.

   Multiplier updates use the issuer's own pattern: re-assert the live value, then schedule the next one in the same transaction.
3. **Writes synthetic issuer fixtures.** They go under `apps/demo/out/<run>/issuer-fixtures/`, in the recorded xStocks response shapes, so they pass the same Zod schemas.
4. **Creates the demo database.** `corpact_demo` is dropped and recreated, and the worker runs `migrate`, `sync-registry`, `import-issuer-actions` and `sync-wallet`.
5. **Checks the first sync.** The issuer then publishes a late record and a correction, the worker re-imports and re-syncs, and the checks run again.
6. **Checks determinism.** The worker syncs once more with no new evidence, and the checks confirm nothing changed.
7. **Checks the independent provider.** Throughout, a local JSON-RPC proxy on its own origin acts as the independent reconciliation provider (`RECONCILIATION_RPC_URL`). It misreports one DDIVx balance by one raw unit, the worker re-syncs, and the checks run. It is then honest again, the worker re-syncs, and the checks run once more.
7. **Writes the report.** `apps/demo/out/<run>/report.json` records every event and check.

## Trap → check

| Phase 0 finding or release-checklist item | Scenario event | What must hold |
|---|---|---|
| Verified dividend with no account transfer | D1 | Dividend with USD from issuer net cash |
| Historical transfers replay deterministically | Deposit before D2, withdrawal before S1 | Position `complete` and reconciled to the exact raw chain balance |
| STRCx 2025-11-30: issuer cash implying ~$953k/share | D3 (net $350 on a ~$100 reinvestment) | Dividend kept, USD **unknown**, warning names the implied price |
| 16 dividends with null `netCashflowUsd` | D4 | Dividend kept, USD **unknown**, counted as unvalued, never zero |
| A split books no income | S1 (2-for-1, `ForwardSplit` 1→2) | `split` entry; position income equals the valued dividends exactly |
| Multiplier-history `reason` is not evidence | SP (spin-off labelled "Dividend") | `unclassified_adjustment`: SpinOff has no income policy |
| Multiplier changes with no corporate action | N1 | `unclassified_adjustment`: no published issuer action matches |
| Pending value overwritten before activation | X (×1.01, replaced by D5's transaction) | Version `superseded`; never booked |
| Issuer endpoints disagree in the last bit (HONx) | D5 (issuer decimal is the adjacent f64) | Still a verified dividend (4ε match) |
| Late publication (VTIx, 70 s) | D6 (published 20 s after its schedule) | Applies at publication; no history gap |
| Late ingestion | D7 (issuer record published after the first sync) | Unclassified first, then recognized as a dividend (revision 2) |
| Issuer corrections (STRCx c5721924) | D1 v2 `Corrected`, withholding 30% → 34% | Revision 2 with new USD; reversal + replacement in the journal; earlier rows unchanged; conversion paused for review |
| Partial history is visible and excluded from yield claims | DPARx (funded before the first multiplier write the backfill can see) | Position `partial` with the reason; every yield window excluded as `position_incomplete`; DDIVx still claims yield over its tracked period |
| Corrections and late data replay deterministically | Final re-sync | No new journal rows; income entries and positions identical |
| Documented activation time is not the real one | Every event (activations at arbitrary seconds) | Classification matches the on-chain timestamp exactly |
| Primary RPC plus an independent reconciliation RPC | Honest proxy during the first three phases | Every balance cross-check agrees |
| Pause on source disagreement; keep reads available | Proxy misreports one DDIVx balance | Disagreement recorded with both values; conversion paused for DDIVx only; ledger and reads unchanged; `/v1/ops/status` critical |
| Recovery | Proxy honest again | Latest check agrees; the pause lifts; monitoring no longer critical |

**Not covered:** the CRWDx price-source disagreement. There is no price source yet, so there is nothing to disagree.

## Safety

- **Local chain only.** The chain helpers refuse any RPC or WebSocket host other than `127.0.0.1`/`localhost`, and the validator is started fresh; the demo will not attach to an existing one.
- **Demo database only.** The only database created or dropped is `corpact_demo`, and only on a local Postgres.
- **Clean worker environment.** Worker commands get an environment built from scratch: the demo database, the local RPC, `ISSUER_SOURCE=fixtures` and the generated fixture directory. The repo `.env`, and with it the mainnet RPC key, is never loaded.
- **No live issuer access.** No step reads `api.xstocks.fi`. Synthetic records are labelled `SYNTHETIC` in `_source` and in asset names. `apps/demo/out/` is gitignored.

## Looking at a run

The `corpact_demo` database survives until the next run:

1. Start the API with `DATABASE_URL` pointed at it (`PORT=4700`).
2. Create a tenant and key there (`pnpm tenants create demo …`, `pnpm keys create …`), then sync or register the holder address printed at the end of the run.
3. Point a dashboard's `CORPACT_API_URL` at that API.

Synthetic events never mix with the mainnet ledger, because they live in a different database.
