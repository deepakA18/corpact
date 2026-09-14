# Corpact demo

One command runs the whole demo on a local Surfpool network. It walks through the plan's demo script, shows six real recorded cases beside the naive reading, and runs the full trap regression suite. The worker, classifier, ledger and API run unmodified, and every number shown is read back through the real API.

From a fresh clone, one command checks prerequisites, installs, starts Postgres and runs the demo:

```bash
brew install txtx/taps/surfpool           # Surfpool 1.0 (once)
pnpm demo                                  # = tools/demo/run-demo.sh; ~5 minutes; exits non-zero if any check fails
tools/demo/run-demo.sh solana-test-validator   # the same demo on the Agave test validator
```

It needs Node 24, pnpm 10 and a running Docker, and nothing else. The demo creates everything it uses:
- its own `corpact_demo` database, migrated and permanently labelled synthetic;
- its own tenant and API keys, with the real API called in-process;
- a local network with generated keys;
- the issuer fixtures.

It never reads the repo `.env`, needs no RPC key, and does not depend on any other database, running service or registered wallet.

Output goes to `apps/demo/out/<run>/`:
- `walkthrough.md`: the narrated run, ready to send;
- `report.json`: every event and check.

A verified run is kept at [demo-walkthrough-sample.md](demo-walkthrough-sample.md).

**What to send.**
- **Leave-behind:** [what-this-catches.md](findings/what-this-catches.md), generated from recorded issuer data by `pnpm --filter @corpact/demo catches`.
- **Walkthrough:** a run's `walkthrough.md`.

## The three parts

### Part 1: Walkthrough (synthetic)

A holder of 100 DWLKx on a local network. Each step syncs the worker and reads the API before showing anything.

| Step | What it shows | Pinned by |
|---|---|---|
| 1. Position | Raw base units (`10000000000`), displayed quantity (100), protected floor (100), complete and reconciled | Status, raw balance, quantity and floor |
| 2. No-transfer dividend | A scheduled multiplier change activates by chain time: the raw balance and the token account's transaction count are unchanged, and the displayed quantity rises to 100.35 | Unchanged raw balance and transaction count; quantity 100.35 |
| 3. Dividend entry | 0.35 extra shares; estimated value $35.00 from issuer net cash, not a market price; retained in stock, $0 USDC | Kind, $35, `issuer_net_cash`, "remains invested", floor 100, available 0.35 |
| 4. Split | 2-for-1: quantity 200.70, floor 200, income still $35.00; the split entry has no USD | Split factor 2, USD null, income unchanged |
| 5. Correction | The issuer revises withholding from 30% to 34%. The journal keeps #1 ($35), appends a reversal and a $33 replacement, and pauses conversion for review | Reversal and replacement exist; the original row is unchanged; revision 2 |

### Part 2: Recorded cases beside the naive reading (recorded issuer data)

These are six cases a buyer cannot trivially rebuild, computed from `fixtures/xstocks/recorded-20260913` (both issuer feeds, as the worker imports them) by the production classifier.

- **HONx 2026-06-29 spin-off.** The multiplier goes from 0.5120 to 0.9991. The naive reading books 95.11% more shares as income, worth the issuer's $216.66 per share. Corpact books a basis allocation: 48.75% of the position's value came from the distribution, as principal. No income.
- **STRCx 2025-11-30.** The issuer states $0.627 net cash per share, for 0.00000066 shares delivered. The naive reading books $0.627 per share. Corpact keeps the dividend with USD unknown, because the cash implies $953,728 per share against a $94.80 median.
- **KRAQx 2026-03-26, rights labelled `UnitSplit`.** A 1:1 unit split cannot move a multiplier by +1.38%. Corpact books a rights distribution (basis allocation), because the issuer note reports warrants sold and reinvested.
- **SCCOx 2026-08-12, six versions.** The highest version is `Cancelled`. Corpact resolves on the delivered v5 as a stock dividend (×1.015318), and reports the superseded 1:1.012.
- **LINx 2026-03-26 withholding refund.** Published as a `Corrected` version of the 2026-03-11 dividend. Corpact keeps both: a $1.12 dividend and a $0.48 withholding adjustment, which together equal the $1.60 gross.
- **AZNx 2026-02-02, labelled "ReverseSplit".** Same ×0.5 as a real reverse split. Corpact books an identity change (NASDAQ ADR → NYSE ordinary) and writes the lineage.

The same figures are pinned by `apps/demo/src/recorded.test.ts` and `packages/accounting/src/basis-events.test.ts`, which run in `pnpm test`.

### Part 3: Trap regression suite (synthetic)

| Phase 0 finding or release-checklist item | Scenario event | What must hold |
|---|---|---|
| Verified dividend with no account transfer | D1 | Dividend with USD from issuer net cash |
| Historical transfers replay deterministically | Deposit before D2, withdrawal before S1 | Position `complete` and reconciled to the exact raw chain balance |
| STRCx: issuer cash implying ~$953k/share | D3 (net $350 on a ~$100 reinvestment) | Dividend kept; USD **unknown**; the warning names the implied price |
| 16 dividends with null `netCashflowUsd` | D4 | Dividend kept; USD **unknown**; counted as unvalued, never zero |
| A split books no income | S1 (2-for-1) | `split` entry; position income equals the valued dividends exactly |
| Multiplier-history `reason` is not evidence; a spin-off is a basis allocation | SP (spin-off labelled "Dividend") | v1: `unclassified_adjustment`, "booked as a basis allocation, not income". v2: `type: spin_off`, `treatment: basis_allocation`, validated, activated, no USD |
| Multiplier changes with no corporate action | N1 | `unclassified_adjustment`: no issuer action matches |
| Pending value overwritten before activation | X (×1.01, replaced) | Version `superseded`; never booked |
| Issuer endpoints disagree in the last bit (HONx) | D5 (issuer decimal is the adjacent f64) | Still a verified dividend |
| Late publication (VTIx, 70 s) | D6 (published 20 s late) | Applies at publication; no history gap |
| Late ingestion | D7 (issuer record published after the first sync) | Unclassified first, then a verified dividend |
| Issuer corrections | D1 revision 2 | Reversal plus replacement; earlier rows unchanged; conversion paused |
| Partial history is excluded from yield claims | DPARx (held before its first observable multiplier write) | `partial`; every yield window excluded as `position_incomplete` |
| Deterministic replay | Final re-sync | No new journal rows; identical income and positions |
| Independent reconciliation RPC | Honest proxy | Every balance cross-check agrees |
| Pause on source disagreement | Proxy misreports one balance by one raw unit | Recorded; conversion paused for that position only; ledger untouched; monitoring critical |
| Recovery | Proxy honest again | Pause lifts; monitoring no longer critical |

Late data and corrections are also pinned below the chain layer, on recorded KOx data, by `apps/worker/src/late-and-corrections.test.ts`.

**Not covered:** the CRWDx price-source disagreement. There is no price source yet, so Corpact publishes no market-price valuations.

## Synthetic data can never pass for real data

- **Network.** Surfpool runs `--offline`, with no mainnet datasource. It holds only built-in programs and the accounts this run creates, all from freshly generated keys.
- **Database.** The demo uses its own database, `corpact_demo`, and permanently labels it synthetic in `dataset_label`. That table is append-only, so a demo database cannot be relabelled real.
- **API.** Every data response (portfolio, income, journal, yield) and `/v1/health` carries `dataset: { kind: "synthetic", description }`, and every response sets `x-corpact-dataset: synthetic`. The real ledger reports `mainnet`.
- **Exports.** Every CSV row starts with a `dataset` column, and synthetic files are named `corpact-SYNTHETIC-…`.
- **Dashboard.** Pointed at a synthetic database, every page shows a **SYNTHETIC DEMO DATA** banner.
- **Run output.** Asset names say SYNTHETIC; `walkthrough.md` labels Parts 1 and 3 synthetic and Part 2 recorded; `report.json` starts with `"dataset": "synthetic"`.

## Surfpool compatibility

Surfpool 1.0.0 has two RPC bugs the production worker correctly refuses to work around:
- `getTransaction` and `getBlock` return `blockTime` divided by 1000, so the seconds are lost;
- `getSignaturesForAddress` returns `blockTime: null`.

The demo puts a narrow proxy in front of Surfpool for the worker only (`apps/demo/src/proxy.ts`). It restores those two fields from Surfpool's own `getBlockTime(slot)`, which is correct, and changes nothing else. The same demo also runs against `solana-test-validator` with no proxy (`DEMO_VALIDATOR=solana-test-validator`), which cross-checks that the layer changes no outcome.

Surfpool also ignores SIGTERM. The demo stops it with SIGKILL after 5 s, so no node is left running.

## Safety

- **Local only.** Chain helpers refuse any RPC or WebSocket host other than `127.0.0.1`/`localhost`. The network starts fresh, and the demo will not attach to an existing node.
- **One database.** Only `corpact_demo` is created or dropped, and only on a local Postgres.
- **Clean worker environment.** Worker commands get an environment built from scratch. The repo `.env`, and with it the mainnet RPC key, is never loaded.
- **No live issuer access.** No step calls `api.xstocks.fi`. Part 2 reads recorded files. `apps/demo/out/` is gitignored.

## Real-data check: the AZNx identity change

The demo is offline by design. The one check that needs mainnet is the end-to-end verification of the AZNx ADR conversion on a real wallet ([census §6](findings/corporate-actions-census.md)). It is scripted separately:

```bash
pnpm --filter @corpact/demo lineage-check          # SOLANA_RPC_URL from the environment or .env (archival RPC)
pnpm --filter @corpact/demo lineage-check -- --owner <address>   # a specific wallet instead of discovering one
```

It works in a scratch database, `corpact_lineage_check`, recreated on each run, so the main ledger database is never touched. Issuer data comes from the recorded fixtures. The steps are:
1. Find an AZNx holder from before the conversion, from chain reads.
2. Migrate, verify the registry and import the issuer actions.
3. Sync the wallet with the unmodified worker.
4. Assert on the results:
   - the classification;
   - the lineage rows (basis 1/1, factor 1/2, cash basis 0);
   - the ledger replay and the journal;
   - API v2 (action, detail with lineage, lineage trace) and API v1 (unchanged);
   - `verify-integrity`.

Output names counts and statuses, never the wallet. A busy wallet can take many minutes to sync.

## Looking at a run

`corpact_demo` survives until the next run.

1. Start an API on it: `DATABASE_URL=…/corpact_demo PORT=4700 pnpm start` in `apps/api`.
2. Create a tenant and key.
3. Register the holder addresses from `report.json`.
4. Point a dashboard's `CORPACT_API_URL` at that API.

Every page then shows the synthetic banner.
