# Phase 0 validation scripts

Reproduce the numbers in [`docs/findings/phase0-validation.md`](../../docs/findings/phase0-validation.md). Read-only: nothing here signs or sends a transaction.

```bash
cd tools/validate
mkdir -p out
npm init -y >/dev/null && npm i @solana/web3.js@1   # scratch deps, not part of the workspace

node crawl-multiplier-history.mjs   # every Solana xStock + its multiplier history  → out/xstocks-solana-history.json
node corporate-actions-join.mjs     # all corporate actions, joined to multiplier history → out/ca-*.json
node mint-vs-api.mjs                # decode Scaled UI config from mint bytes, compare to issuer API
node demand-scan.mjs                # §0.1 holders × dividend events → out/demand-result.json   (~40 min on public RPC)
node demand-retry.mjs               # re-run assets the scan lost to rate limits
node wallet-profile.mjs             # §0.1 refinement: bucket material-income wallets (issuer key / hot wallet / broad book / concentrated / plausibly individual) → out/wallet-profiles.json
```

`wallet-profile.mjs` writes wallet addresses. Keep its output in `out/` (gitignored) and commit only aggregate counts. Its buckets are behavioural heuristics with thresholds at the top of the file, not identities.

`SOLANA_RPC_URL` overrides the public endpoint for `demand-scan.mjs`. Public RPC rate-limits `getProgramAccounts`; five assets needed a retry on 2026-09-13.

## What the demand scan measures, and what it does not

- **Current holders stand in for event-time holders.** Without archival history, a wallet that bought yesterday is credited with a year of dividends, and one that sold is missed. Treat per-wallet income as an order-of-magnitude estimate.
- **Program-owned (off-curve) owners are excluded** - pools, vaults, escrow. On-curve exchange or market-maker wallets are *not* excluded and likely dominate the top of the distribution.
- **Valuation** is `B × ΔM × latest scaled price`: a current indicative price, not the event-time price.
- `out/` is scratch output; the committed summary lives in [`docs/findings/evidence/`](../../docs/findings/evidence/).
