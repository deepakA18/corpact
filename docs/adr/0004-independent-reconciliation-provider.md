# ADR-0004: Cross-check chain reads against an independent provider

Status: accepted, 2026-09-14

## Context

Every number Corpact publishes comes from one RPC provider's view of the chain. That covers balance history, the multiplier timeline and the inventory used for exact reconciliation. Replay against a single provider proves the ledger agrees with that provider, not with the chain. A provider serving stale or wrong account state, from a lagging node, a cache bug or a bad upgrade, would reconcile perfectly and still be wrong.

PLAN Appendix B asks for "a primary RPC/history provider plus an independent reconciliation RPC", and for pausing the affected mint on source disagreement while keeping reads available.

## Decision

**What gets cross-checked.** `RECONCILIATION_RPC_URL` names a second provider, which must be a different origin from `SOLANA_RPC_URL`. It is optional; without it, monitoring warns. Two reads are cross-checked, both cheap enough for a second provider's free tier:

- **Balances:** the wallet inventory taken for each position rebuild, one `getTokenAccountsByOwner`.
- **Mint state:** the multiplier configuration of mints with positions, on each mint poll, one `getMultipleAccounts` per 100 mints. The fields compared are owner, decimals, multiplier authority, multiplier, pending multiplier and activation time. Supply is excluded because it moves constantly.

**Aligning slots.**

1. The secondary is read with `minContextSlot` equal to the primary's slot.
2. If the reads differ and the slots differ, the primary is read again at the secondary's slot or later.
3. A difference that remains is a **disagreement** only if one of these holds:
   - the slots now match; or
   - the primary reports the same value on both sides of the secondary's slot, so nothing legitimately changed in between.

   Otherwise it is **inconclusive**. A provider error is also inconclusive, never a failure of the ledger job.

**Recording outcomes.** Every outcome is appended to `provider_checks`. Agreement on a polled mint is re-recorded at most hourly; disagreements and inconclusive results are recorded every time.

**What a disagreement does.** Conversion is disabled for the affected positions, with the observed values in the reason. Nothing in the ledger changes: history, income and journal stay as replayed from the primary. When the latest check agrees again, the next rebuild lifts the pause. A mint-state disagreement appearing or clearing enqueues rebuilds for its holders. `/v1/ops/status` reports `provider_agreement` as critical while any subject's latest check disagrees.

## Consequences

- **What it detects.** A wrong balance or multiplier state from either provider is visible within one poll or rebuild, and cannot become a conversion amount.
- **What it does not cover.** Historical transactions are still read from the primary alone. The check covers current state, which is what reconciliation compares the replay against. A provider that corrupts history would already fail exact reconciliation against the current balance, unless it also corrupts that balance, which is exactly what this check covers.
- **What it costs.** A second provider account. Public mainnet RPC is enough for these two calls per rebuild and per poll, but it is rate-limited.
- **How it is proven.** The synthetic demo (`docs/demo.md`) runs an honest proxy as the second provider, then has it misreport one balance by one raw unit. The demo checks that the disagreement is recorded, that only that position's conversion pauses, that the ledger is untouched, that monitoring goes critical, and that everything clears once the proxy is honest again.
