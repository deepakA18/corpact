# ADR-0002: Archival history on standard JSON-RPC; Helius proposed for production

**Status:** Accepted for development · production provider **proposed, unverified** · **Date:** 2026-09-13

## Context

The ledger needs, per allowlisted xStock mint, every Scaled UI multiplier write. Per wallet, it needs every balance change on every token account the wallet ever owned, including non-associated and closed accounts, owner changes, and inner instructions. `getTokenAccountsByOwner` only shows what is open now.

## What was verified on mainnet (public RPC, 2026-09-13)

| Question | Result |
|---|---|
| Is a **closed** token account's history retrievable? | Yes. `7BqCh…aAtw` (SPYx, closed that day) returns `null` from `getAccountInfo` and still lists its signatures in `getSignaturesForAddress`. |
| Can history be paged to a point in time? | Yes. `getSignaturesForAddress(..., { before })` accepts a signature that is *not* in the address's history and returns only older entries. |
| Does `getTransaction` carry what reconstruction needs? | Yes (`encoding: "json"`). `pre/postTokenBalances` give raw `amount`, `owner`, `mint` and `programId` per account index. `meta.loadedAddresses` resolves lookup-table accounts. `meta.innerInstructions` covers CPI transfers. |
| Can the multiplier timeline come from chain data alone? | Yes. Each xStocks `UpdateMultiplier` transaction holds two instructions for one mint: the current multiplier with its past timestamp, then the new one with its future timestamp. The Token-2022 processor's promotion and supersession rules are replicated in `packages/solana/src/timeline.ts`. |

## Decision

1. **Ingestion uses only standard JSON-RPC:** `getSignaturesForAddress`, `getTransaction`, `getMultipleAccounts`, `getTokenAccountsByOwner`, `getBlock` and `getBlockTime`, through `@solana/kit`. The provider is a single `SOLANA_RPC_URL`, with no proprietary methods on the critical path.
2. **Account discovery for a wallet** is the current inventory plus every token account whose `owner` appears as the wallet in the pre- or post-balances of the wallet's own transactions. Every account a wallet ever owned is either still owned, which the inventory shows, or left its ownership through `CloseAccount` or `SetAuthority`. Both require the wallet's signature, so they appear in its history. Each discovered account's own signature history then supplies inbound transfers the wallet never signed.
3. **Multiplier history** is fetched from the issuer's multiplier-authority signature stream in targeted windows. The windows are hinted by the *recorded* issuer schedule, plus the mint's own pending timestamp for anything newer. The timeline is then **verified against live mint state**. A missing write shows up as a stored-state mismatch or as an unexplained re-assert, and marks the mint's coverage as gapped rather than guessed.
4. **Development and demo** run on the public mainnet endpoint. **Production proposal: Helius.** Its docs state standard archival methods from genesis, plus an optional `getTransactionsForAddress` with `filters.tokenAccounts` that could replace per-account signature scans (slot ≥ 111,491,819, Dec 2022; 1,000 per page; 10 credits per 100 full transactions). **Not verified:** plan availability, rate limits and real throughput. Verify these with an account before committing.

## Measured on a real wallet (2026-09-13)

One public wallet: 5 xStock positions, 40 transactions. The multiplier authority's signature index is 151,040 signatures back to 2025-07-01, built once and shared by every mint.

| Endpoint | Result |
|---|---|
| Public mainnet RPC | Stopped after 17 min, 2 of 5 mints done. `getTokenAccountsByOwner` is capped at 10 per window, and the full sync failed on its first attempt. |
| Helius (key in `.env`) | Full sync in **40 s**, 0 rate-limit retries. A re-sync using stored observations took 5 s. A burst of 40 concurrent requests returned 8 × HTTP 429, so the worker runs at 8 concurrent requests. |

## Known limits

- **Public RPC** is heavily rate-limited (HTTP 429 under modest concurrency) and not usable for production backfills. A wallet with thousands of transactions takes minutes.
- **Discovery edge case:** an account closed by a separate `closeAuthority`, never signed by the owner and never still open, is only found if another of the wallet's transactions touches it. Wallets where this matters are reported with a gap, not assumed complete.
- **`getTransaction` has no transaction index.** Ordering within a slot is resolved from `getBlock` only when two relevant events share a slot.
- **Triton Old Faithful** documents archival `getBlock`/`getTransaction`, but not whether `getSignaturesForAddress` is served from the archive. It is unevaluated.
- The issuer schedule hint comes from recorded fixtures (see [ADR-0001](0001-classify-from-corporate-actions.md) and the data-rights constraint). A multiplier write the recording does not know about is still caught by verification against the mint, but not located. Locating it needs a wider authority scan.
