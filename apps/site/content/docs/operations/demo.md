---
title: Running the demo
description: The whole flow on a local Surfpool network, in one command.
---

## Run it

```bash
brew install txtx/taps/surfpool      # Surfpool 1.0
docker compose up -d                  # Postgres
pnpm --filter @corpact/demo demo      # about 4½ minutes; exits 1 if any check fails
```

The run writes `walkthrough.md` and `report.json` to `apps/demo/out/<run>/`. Set `DEMO_VALIDATOR=solana-test-validator` to run on the Agave test validator instead.

## What you see

### Part 1: Walkthrough (synthetic)

1. **Position.** A holder of 100 units: raw base units, displayed quantity and protected floor.
2. **No-transfer dividend.** A scheduled multiplier change activates. The raw balance and the account's transaction count stay the same, and the displayed quantity rises.
3. **Dividend entry.** 0.35 extra shares, worth $35.00 from issuer net cash, retained in stock.
4. **Split.** 2-for-1: the quantity and the floor double, and income stays $35.00.
5. **Correction.** The issuer revises withholding. The journal keeps the original, appends a reversal and a $33.00 replacement, and pauses conversion.

### Part 2: Recorded cases

Six cases from recorded issuer data, side by side with the naive reading: the HONx spin-off, STRCx implausible cash, the KRAQx rights sale labelled `UnitSplit`, the SCCOx stock dividend with six versions, the LINx withholding refund, and the AZNx ADR conversion labelled "ReverseSplit".

### Part 3: Trap regression suite

Every Phase 0 trap the ledger can reproduce without a price source runs end to end:
- missing and implausible cash;
- a spin-off labelled "Dividend";
- a superseded schedule, a late publication and a late issuer record;
- partial history;
- deterministic replay;
- an independent provider that disagrees, then agrees again.

## Synthetic data is labelled everywhere

- **Network.** Surfpool runs offline, with keys generated per run.
- **Database.** `corpact_demo` is permanently labelled synthetic, and every response, header and CSV row says so. See [Synthetic vs mainnet data](/docs/concepts/datasets).

> [!NOTE] Surfpool compatibility
> Surfpool 1.0.0 returns `blockTime` in the wrong unit from `getTransaction` and `getBlock`, and null from `getSignaturesForAddress`. The demo restores both from Surfpool's own `getBlockTime` at the RPC boundary; the worker runs unmodified. The same 59 checks pass on `solana-test-validator` with no compatibility layer (verified 2026-09-14: 59/59 on both networks).
