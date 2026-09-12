# Phase 0 investigation tools

Reproduces every number in [`docs/findings/`](../../docs/findings/). Read-only — nothing here signs or sends a transaction.

```bash
npm install
```

| Tool | Answers | Spec § |
|---|---|---|
| `inspect-mints.js` | Token program, full extension list, hook/delegate/pause authorities, metadata per mint | 0.1 |
| `pda-custody-check.js` | Do program-owned PDAs already custody these wrappers on mainnet? | 0.1 |
| `decode-scaled-ui.js` | Current multiplier, staged value, effective timestamp, pause state | 0.2 |
| `multiplier-history.js` | Update cadence and whether updates are staged ahead or take effect immediately | 0.2 |
| `pyth-coverage.js` | Feed availability, market-hours semantics, on-chain account staleness | 0.4 |
| `wrapper-census.js` | Is there actually a fragmented market to consolidate? | premise test |
| `depth-fragmentation.js` | Routable depth at 100/300/1000bps per wrapper | §12 metric #1 |

## Configuration

- `mints.json` — the candidate wrapper set. **Mints are authoritative; symbols are not.** Impostor tokens with identical names and symbols are live on mainnet.
- `SOLANA_RPC_URL` — defaults to the public endpoint. Set an archival provider for anything historical.
- `TICKERS=NVDA,AAPL` — narrows `wrapper-census.js` and `depth-fragmentation.js`.
- `QUOTE_DELAY_MS` — inter-quote delay for `depth-fragmentation.js`. Raise it on rate-limit errors.

## Known limits of the free tier

These shaped how the tools are written, and are worth knowing before trusting a run:

- **Indexed RPC calls are paywalled everywhere.** `getTokenLargestAccounts` returns 429 or demands a key on every free endpoint tried. `pda-custody-check.js` therefore works backwards from live AMM pools instead of enumerating holders.
- **`getTransaction` is throttled hard.** A full multiplier-cadence series needs an archival provider; `multiplier-history.js` is scoped to answer the cheaper and more decisive question — did a write land *at* its effective instant or before it?
- **Hermes price routes require credentials** (HTTP 401, including for always-on feeds). `pyth-coverage.js` reads on-chain price accounts instead, and probes BTC/USD as a control so an auth failure cannot be mistaken for a closed market.
- **Jupiter's free tier rate-limits aggressively** and rejects `restrictIntermediateTokens=false`. `depth-fragmentation.js` reports `THROTTLED` rather than `$0` when it runs out of retries — an earlier version collapsed the two and silently reported $661k of real SPCX liquidity as "no route".

That last point generalises: **every probe here distinguishes "no data" from "could not fetch", and uses a control case to tell them apart.** Phase 0 produced two wrong conclusions before that rule was applied.
