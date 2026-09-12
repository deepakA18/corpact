# Phase 0 — Investigation results

Spec §3 gates all program code behind these deliverables. This is the summary; each finding links to its evidence and its reproduction command.

**Investigated:** 2026-09-12 (Saturday, US equity market closed) · **Network:** Solana mainnet

---

## Status

| § | Deliverable | Status | Verdict |
|---|---|---|---|
| 0.1 | [`token-extensions.md`](token-extensions.md) | ✅ Complete | Pooling is viable. The blocking risk did not materialise; four unmodelled ones did. |
| 0.2 | [`normalization-sources.md`](normalization-sources.md) | ✅ Primary question answered | The scalar is already on-chain. **Do not build the normalization oracle.** |
| 0.3 | [`legal-posture.md`](legal-posture.md) | ⛔ Blocked | Requires external counsel. Engineering brief prepared. |
| 0.4 | [`oracle-coverage.md`](oracle-coverage.md) | ⚠️ Complete, bad news | Feeds exist; **no usable price path exists today.** |
| — | [`liquidity-fragmentation.md`](liquidity-fragmentation.md) | ⚠️ Complete | **§1's premise does not hold today.** Added beyond scope; see below. |

## Go / no-go on the architecture

§0.1 defines the escalation condition: *"If the top two issuers both block PDA custody, escalate immediately — the product needs a different shape."*

**That condition is not met.** No candidate wrapper has a transfer hook installed, and program-owned PDAs already custody these tokens on mainnet at size. Tier 1 is technically buildable.

**But a different condition, which §3 did not anticipate, is met.** The market §1 describes as fragmented is not fragmented today. Across 18 underlyings and $18.0M of on-chain liquidity, **3.7% sits outside the deepest wrapper — and 98% of that 3.7% is a single pre-IPO underlying the spec excludes from v1.** xStocks holds ≥95% of liquidity in all 18.

§13 says to say so loudly rather than build around it. That is [`liquidity-fragmentation.md`](liquidity-fragmentation.md), and it is the most important thing in Phase 0.

**Recommendation: proceed with Phase 1 exactly as specified. Do not commit to Phase 2 until Phase 1 data justifies it.** Phase 1 is unaffected by the finding — arguably made more valuable by the oracle gap — and §11 already designs it to ship standalone. It also produces exactly the evidence needed to decide Phase 2 on data rather than on §1's premise.

---

## The five findings

### 1. No transfer hooks — but custody is revocable at any moment

All eight candidate mints are Token-2022 with a `TransferHook` extension whose `program_id` is null. There is no eligibility predicate to satisfy. Nine program-owned pool vaults were observed holding these wrappers on Raydium CLMM and Meteora DLMM, none frozen, trading daily.

The risk is elsewhere. Every issuer retains a **live hook authority**; every live vault already carries `TransferHookAccount`, so a hook can be switched on with no migration and no warning. xStocks and Backpack hold a **`PermanentDelegate`** — unilateral power to move tokens out of a pool vault. All eight have **global pause** and **freeze** authority.

→ [ADR-003](../adr/0003-registry-tracks-issuer-powers.md): `registry` tracks these as live monitored state with an extension fingerprint that auto-pauses deposits on any change.

### 2. The normalization scalar is already on-chain

All eight wrappers carry `ScaledUiAmountConfig`. Its multiplier **is** §0.2's `shares_per_token`, written by the issuer, readable in the same account load as the balance. §0.2 called a Parity-run normalization oracle "the single greatest source of value leakage in this design" — it should not be built at all.

Ondo writes updates with **immediate effect** (same slot, no notice), so any cached value is provably unsafe. The scalar must be read live from the mint inside each instruction.

Measured divergence between issuers today is small: **0.14 bps** (NVDA), **1.07 bps** (AAPL). The NVDAx step on 2026-09-10 was **+7.82 bps** — ~$827 free to an arbitrageur on a 5,000-share pool that had not repriced.

→ [ADR-002](../adr/0002-normalization-from-scaled-ui-amount.md): read live, guard on the read path, delete `update_shares_per_token`.

### 3. There is no working price feed

Pyth Hermes price routes now return **HTTP 401** — verified against the always-on BTC control feed, so it is authentication, not market hours. The sponsored on-chain equity accounts are stale by **17 days (NVDA)** and **28.8 days (AAPL)**; the BTC control account, same parser, is current. `Equity.Index.*` ("24/7") variants and `Equity.US.SPCX` have no on-chain account at all.

Phase 1's deliverable is a basis dashboard. There is no basis without a price. **Hermes credentials and a Parity-run price pusher are on Phase 1's critical path.**

### 4. The market is not fragmented — it is an xStocks monopoly

| | |
|---|---|
| Underlyings measured | 18 |
| Total on-chain pool liquidity | $18.0M |
| Liquidity outside the deepest wrapper | **$674k (3.7%)** |
| Of which SPCX (pre-IPO, v1 non-goal) | **$661k** |
| Excluding SPCX | **$13k (0.08%)** |
| Underlyings where xStocks is deepest | **18 / 18** |

§1's worked example is inverted: it states CRCLON ~$130M vs CRCLX ~$41M. Observed — CRCLx **$75.1M** market cap / **$2.12M** liquidity; CRCLon **$656k** / **$207**. xStocks is ~114× larger by market cap. **§1's figures must be re-sourced before being repeated externally.**

SPCX is the one genuine head-to-head: xStocks 60.6% / Backpack 39.4%, $4.7M combined daily volume. It is also pre-IPO, excluded by §10, and has its multiplier pinned at 1.0 so it exercises no normalization machinery. **The one underlying where the thesis demonstrably holds is the one the spec forbids v1 from touching.**

### 5. Off-hours thinness is larger than fragmentation

Measured with the market closed: **$278k moves NVDAx 100bps**; AAPLx, $95k. A $1M off-hours order on the deepest tokenized equity on Solana is a ~10% impact event. The dominant NVDAx venue routed by Jupiter quotes off an oracle that intermittently reports itself stale.

The §6 off-hours problem is real, measurable, and substantially larger than the problem Tier 1 addresses.

---

## What this changes in the spec

| Spec section | Change | Source |
|---|---|---|
| §1 | CRCL figures inverted; re-source or strike | [fragmentation §3](liquidity-fragmentation.md) |
| §5.1 `Wrapper` | Add permanent-delegate, pausable, freeze, hook-authority, extension fingerprint | [ADR-003](../adr/0003-registry-tracks-issuer-powers.md) |
| §5.1 `update_shares_per_token` | **Remove.** Replace with read-path delta guard | [ADR-002](../adr/0002-normalization-from-scaled-ui-amount.md) |
| §5.1 `IssuerTier` | Split into `custody_tier` and `onchain_risk_tier` | [ADR-003](../adr/0003-registry-tracks-issuer-powers.md) |
| §5.2 `withdraw_proportional` | Guarantee does not survive a frozen/seized leg — **unresolved, blocks `parity_pool`** | [tokens §5](token-extensions.md) |
| §5.2 deposit math | Fold decimals: wrappers use 6, 8 and 9 | [normalization §6](normalization-sources.md) |
| §5.4 NAV orders | Must carry a price update in the transaction | [oracle §7](oracle-coverage.md) |
| §7.2 breakers | Add rows for issuer transfer-policy changes | [ADR-003](../adr/0003-registry-tracks-issuer-powers.md) |
| §8.1 indexer | Extend subscription to mint and vault accounts | [tokens §5](token-extensions.md) |
| §8.2 pricing | Add a Pyth pusher; Hermes credentials are a procurement item | [oracle §7](oracle-coverage.md) |
| §8.3 `corpactions` | Demoted from highest-consequence write to monitoring-only | [ADR-002](../adr/0002-normalization-from-scaled-ui-amount.md) |
| §11 Phase 2 | Gate on evidence, not on §1's premise | [fragmentation §7](liquidity-fragmentation.md) |

## Blocking before `parity_pool`

1. **Accrual surplus disposition.** Wrappers accrue; `pTICKER` supply is fixed; the pool accumulates surplus shares. The spec never says where they go, and the three options are not legally equivalent. → [normalization §7](normalization-sources.md)
2. **Proportional withdrawal under an undeliverable leg.** §5.2's run-safety valve breaks if one wrapper is frozen or seized. → [ADR-003](../adr/0003-registry-tracks-issuer-powers.md)
3. **Multiplier direction proven on a fork.** An inverted scalar is a silent, total mispricing.
4. **Maximum N per pool.** ADR-002 adds a mint account per wrapper per instruction; the transaction account limit bounds pool size. Measure before scoping Orbital.

## Reproducing

```bash
cd tools/phase0 && npm install

node inspect-mints.js          # §0.1  extension matrix per mint
node pda-custody-check.js      # §0.1  live pool vaults holding each wrapper
node decode-scaled-ui.js       # §0.2  multipliers and pause state
node multiplier-history.js     # §0.2  update cadence and advance notice
node pyth-coverage.js          # §0.4  feed coverage and on-chain staleness
node wrapper-census.js         # premise test across 18 underlyings
node depth-fragmentation.js    # routable depth per wrapper
```

Raw output captured in [`evidence/`](evidence/). All tools read `tools/phase0/mints.json` and take `SOLANA_RPC_URL`; the census and depth tools take `TICKERS=`.

## Caveats on the whole of Phase 0

- **One snapshot, on a Saturday, with US equity markets closed.** Depth figures are lower bounds on weekday depth. Liquidity *shares* are far less time-sensitive but should be re-measured during a session before any decision rests on them.
- **On-chain AMM liquidity only.** Issuer mint/redeem, CEX books (Kraken, Bybit, Backpack) and OTC flow are not counted. If Ondo's depth lives on a CEX, cross-issuer fragmentation is real at the market level — but then it is not addressable by an on-chain pool either.
- **Three issuers vetted, 18 underlyings.** xStocks lists 60+ and Ondo 100+. The long tail is unmeasured.
- **Public RPC throttling** prevented completing the multiplier-cadence series and forced several measurements onto indirect paths. An archival provider is needed.
