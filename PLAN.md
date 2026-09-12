# Parity — Unified Liquidity & Execution Layer for Tokenized Equities on Solana

**Implementation specification. Scoped as a production product, not a hackathon build.**

This document is the source of truth for engineering. It is written to be handed to Claude Code as a standing brief. Read it fully before writing code. Phase 0 is investigation, not implementation — do not skip it.

---

## 1. Problem

Tokenized US equities on Solana are a real market (>$4.9B H1 2026 volume, >95% cross-chain share), but the same underlying company exists as multiple, mutually incompatible tokens:

- **xStocks** (Backed Finance, Jersey) — bearer debt instrument / tracker certificate. On-chain multiplier adjusts on dividends and splits. 24/5 issuer mint/redeem.
- **Ondo Global Markets** — custody-backed, total-return tracking, broker-dealer held. Issuer window closes Friday night through Sunday night.
- **Backpack Securities (SPCX etc.)** — closest to real ownership; redeemable via ACATS/DTCC into a UCC Article 8 security entitlement.
- **PreStocks and similar** — SPV-based synthetic pre-IPO exposure. Structurally fragile; the May 2026 Anthropic/OpenAI transfer-void notices cut those tokens ~38–46% in a session.

Consequences:

1. **Fragmented depth.** Circle's ~$171M of tokenized market cap is split across CRCLON (~$130M) and CRCLX (~$41M) — two shallow books on the same chain instead of one deep one.
2. **Non-fungible units.** One xStock token and one Ondo token are not the same claim on the same number of shares. Multipliers and total-return accrual diverge over time.
3. **Peg breaks off-hours.** When issuer mint/redeem windows close, the arbitrage loop that holds the peg is unavailable. Weekend moves of 3–5% against reference have been routine; extreme cases (a ~4× off-hours spike on an AMZN token, +12% intraday on an AAPL token) are documented.
4. **Invisible instrument risk.** Nothing in any UI distinguishes a redeemable, custody-backed claim from an unauthorized SPV wrapper until it breaks.

## 2. What we are building

A **two-tier liquidity system**, one instance per underlying company.

**Tier 1 — Parity Pool.** An N-asset concentrated-liquidity AMM over every allowlisted wrapper of a single underlying, operating in *normalized share units* rather than raw tokens. Depositors mint a canonical share token (`pNVDA`, `pAAPL`, …) representing exactly one normalized share of economic exposure, backed pro rata by the pool's wrapper basket.

**Tier 2 — Quote Pool.** A single concentrated-liquidity market `pTICKER/USDC`. All USDC-side liquidity and price discovery concentrates here, in one book, instead of scattering across four wrapper pairs.

**Execution layer.** Long-term (TWAMM-style) orders for recurring buys and basket rebalances, NAV-banded conditional orders, and an off-hours execution regime for when the peg-keeping arbitrageurs are absent.

**Risk layer.** Per-wrapper exposure caps, depeg circuit breakers, and issuer-quality tiering enforced on-chain.

### Why the canonical token is the product

It collapses "which NVDA do I buy" into "NVDA," consolidates depth into one book, and becomes the natural integration target for wallets, lenders, and index products. Depth compounds: every new wrapper wants inclusion, every router wants the deepest venue.

### Research basis

Four Paradigm papers are load-bearing. Read them before implementing the corresponding module.

| Paper | URL | Used for |
|---|---|---|
| Orbital (Robinson, Moallemi, White, 2025) | https://www.paradigm.xyz/2025/06/orbital | Tier 1 N-asset parity AMM |
| TWAMM (White, Robinson, Adams, 2021) | https://www.paradigm.xyz/2021/07/twamm | Long-term order execution |
| Gradual Dutch Auctions (Frankie, Robinson, White, andy8052, 2022) | https://www.paradigm.xyz/2022/04/gda | Off-hours clearing without LPs |
| Loss-Versus-Fair (Moallemi, Robinson, 2024) | https://arxiv.org/abs/2406.00113 | Execute-now vs wait cost model |

---

## 3. Phase 0 — Investigation (blocking)

**Do not write program code until these are answered and written up in `docs/findings/`.** Each has the power to change the architecture.

### 0.1 Token-2022 transfer hooks — highest risk item

xStocks and Ondo use Solana Token Extensions, including transfer hooks, to enforce transfer eligibility. If a hook rejects transfers to or from a program-owned PDA, Tier 1 cannot custody that wrapper at all.

For each candidate wrapper mint, determine and document:

- Which token program owns the mint (SPL Token vs Token-2022).
- Full extension list: `TransferHook`, `PermanentDelegate`, `DefaultAccountState`, `TransferFeeConfig`, `ConfidentialTransfer`, `MetadataPointer`, `NonTransferableAccount`, `MintCloseAuthority`.
- If `TransferHook` is present: the hook program ID, its source if public, the extra-account-metas PDA layout, and the exact eligibility predicate.
- Empirically, on mainnet fork: can a PDA hold the token? Can a CPI-initiated transfer to and from that PDA succeed? Does the hook require the *owner* to be on an allowlist?
- Does `PermanentDelegate` exist, and who holds it? A permanent delegate can claw back pool assets. This may be disqualifying for inclusion, or may require explicit user disclosure.

**Deliverable:** `docs/findings/token-extensions.md` with a per-mint compatibility matrix and a go/no-go per wrapper. If the top two issuers both block PDA custody, escalate immediately — the product needs a different shape (routing/attestation rather than pooling).

### 0.2 Share-normalization data

Tier 1 requires, per wrapper, a `shares_per_token` scalar: how many underlying shares one token currently represents.

- xStocks: locate the on-chain multiplier account or issuer API. Determine update frequency, authority, and whether historical values are queryable.
- Ondo: total-return tracking means `shares_per_token` drifts continuously with reinvested dividends rather than stepping. Determine the published NAV/accrual source and its update cadence.
- Backpack: determine the redemption ratio source.

Document update latency, authority keys, and failure modes for each. **The normalization oracle is the single greatest source of value leakage in this design** — a stale or wrong scalar is a free arbitrage against LPs.

**Deliverable:** `docs/findings/normalization-sources.md`.

### 0.3 Legal posture

The canonical token is plausibly a new instrument wrapping securities exposure. Before mainnet:

- Engage securities counsel in the operating jurisdiction. Written memo required.
- Determine whether Parity is a non-custodial protocol, an issuer, or both.
- Determine geofencing requirements and whether the canonical token must itself carry a transfer hook.
- Confirm whether pooling wrappers with different legal characteristics (debt instrument vs security entitlement) creates a disclosure obligation.

**Do not ship mainnet without this memo.** Devnet and testnet work may proceed in parallel.

### 0.4 Pyth coverage

Confirm per-ticker availability of US equity feeds and any NAV feeds, plus market-hours and staleness semantics. Pyth explicitly does not publish a current price outside US equity trading hours; the system must treat "no price" as a first-class state, not an error.

**Deliverable:** `docs/findings/oracle-coverage.md`.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Clients: Next.js web app · REST/WS API · SDK (TS + Rust)    │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────┴─────────────────────────────────┐
│  Off-chain services                                           │
│   indexer · pricing · corporate-actions · risk · keeper      │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────┴─────────────────────────────────┐
│  On-chain programs (Anchor)                                   │
│   registry · parity_pool · quote_pool · orders · baskets      │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 Repository layout

```
parity/
  programs/
    registry/           # wrapper allowlist, normalization, risk state
    parity_pool/        # Tier 1 N-asset parity AMM
    quote_pool/         # Tier 2 CLMM (Phase 3; see §5.2)
    orders/             # TWAMM + conditional orders
    baskets/            # index/portfolio wrappers (Phase 5)
  reference/            # Python reference implementations (source of truth for math)
    orbital.py
    twamm.py
    gda.py
    lvf.py
  services/
    indexer/            # Yellowstone gRPC -> Timescale
    pricing/            # Pyth Hermes, NAV, basis
    corpactions/        # multiplier + dividend ingestion
    risk/               # depeg detection, breaker triggers
    keeper/             # crank execution
    api/                # REST + WS
  app/                  # Next.js frontend
  sdk/
    ts/
    rust/
  docs/
    findings/
    adr/                # architecture decision records
  tests/
    fuzz/
    integration/
    fork/
```

### 4.2 Language and tooling

- Programs: Rust + Anchor. Pin the toolchain in `rust-toolchain.toml`; pin Anchor and Solana CLI versions in `Anchor.toml` and document them in the README.
- Fixed-point math: a single internal `U128Q64` type in a shared crate. **No floating point anywhere in program code.** All rounding decisions explicit and directional (always round in favour of the pool).
- Reference implementations in Python with `mpmath` arbitrary precision. Rust math is verified against these by differential test.
- Off-chain services: Rust for indexer and keeper (latency and correctness), TypeScript for API and frontend.
- Storage: PostgreSQL + TimescaleDB for time series. Redis for hot quotes.

---

## 5. On-chain programs

### 5.1 `registry`

Global configuration and the trust root for everything else.

**State**

```rust
#[account]
pub struct Underlying {
    pub symbol: [u8; 12],            // "NVDA"
    pub pyth_feed_id: [u8; 32],
    pub canonical_mint: Pubkey,      // pNVDA
    pub wrapper_count: u8,
    pub status: UnderlyingStatus,    // Active | Halted | Winding Down
    pub bump: u8,
}

#[account]
pub struct Wrapper {
    pub underlying: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,       // SPL Token or Token-2022
    pub issuer_tier: IssuerTier,     // Tier1 | Tier2 | Tier3
    pub shares_per_token: u128,      // Q64.64, normalization scalar
    pub spt_last_update: i64,
    pub spt_max_staleness: i64,
    pub max_weight_bps: u16,         // exposure cap within the pool
    pub state: WrapperState,         // Active | DepositsPaused | Frozen
    pub has_transfer_hook: bool,
    pub hook_program: Option<Pubkey>,
}
```

**Issuer tiers** (encode the PreStocks lesson directly in state):

- **Tier 1** — redeemable into the real security through recognised rails; regulated broker-dealer custody; current attestations. Eligible for full weight.
- **Tier 2** — custody-backed with issuer-side redemption only, no retail redemption path. Capped weight.
- **Tier 3** — synthetic or SPV-based, or lacking current attestation. **Not eligible for Parity Pools.** May be displayed in the app with an explicit risk label, never pooled.

Admission and tier changes are governance actions behind a timelock (minimum 48h) with an emergency-halt path that can only *restrict*, never expand.

**Normalization updates.** `update_shares_per_token` is callable by a permissioned oracle authority. It must:

- reject updates exceeding a configured per-update delta bound (guards against a compromised or fat-fingered authority),
- emit an event carrying old and new values plus the source attestation hash,
- pause swaps on affected pools for a configured settlement window when the delta exceeds a threshold (a discrete corporate action), so the pool is not arbitraged across the step.

### 5.2 `parity_pool` (Tier 1)

An Orbital-style N-asset AMM. Reserves are tracked in **normalized share units**: `normalized = raw_balance × shares_per_token`.

Because normalized units of every wrapper represent the same economic claim, they should trade at parity — which is precisely the setting Orbital is designed for, and why it is the right invariant rather than a generic multi-asset constant product.

**Invariant.** Reserves `r ∈ R^n` lie on a sphere: `‖r − R·1‖² = R²`, where `1` is the all-ones vector. The equal-price point sits at `r = R(1 − 1/√n)·1`. Concentrated liquidity is expressed as *ticks*: spherical caps bounded by a plane `r · (1/√n)1 ≥ k`, where `k` encodes how far a wrapper is allowed to depeg before that tick's liquidity stops supporting it. Ticks are either interior (free on the sphere) or boundary (pinned to the plane); interior ticks aggregate to a sphere and boundary ticks to a circle, so the combined tradeable surface is a torus.

**Implementation contract for Claude Code:**

1. Implement `reference/orbital.py` first, following the paper's derivations exactly, with arbitrary-precision arithmetic. Include tick aggregation and tick-crossing.
2. Implement the Rust version in fixed point.
3. Write a differential test harness that runs ≥10⁶ randomized trades through both and asserts agreement within 1e-12 relative error, with the Rust side never returning more output than the Python side.
4. Property tests that must hold under fuzz:
   - the invariant is non-decreasing across every operation (fees accrue to the pool),
   - no sequence of swaps can extract value from the pool at constant oracle price,
   - a swap followed by its exact reverse leaves the caller strictly worse off by at least the fee,
   - tick crossing is path-independent for the same net trade.

Do not attempt to derive the quartic solve from memory. Use the paper. If the paper's formulation is ambiguous at any point, record the ambiguity in `docs/adr/` and choose the conservative (pool-favouring) reading.

**Canonical token mechanics.**

- `deposit(wrapper, amount)` → mints `amount × shares_per_token` of `pTICKER`, subject to that wrapper's `max_weight_bps` cap. Deposits that would breach the cap are rejected, not partially filled.
- `withdraw_proportional(amount)` → burns `pTICKER`, returns a pro-rata slice of every wrapper. Always available while the pool is not frozen.
- `withdraw_single(wrapper, amount)` → burns `pTICKER`, returns one wrapper, priced along the Orbital curve so that draining an underweight wrapper costs more. Disabled for any wrapper in `DepositsPaused` or `Frozen`.

`withdraw_proportional` is the run-safety valve: it cannot be gamed to exit the good assets and leave the bad ones behind.

### 5.3 `quote_pool` (Tier 2)

`pTICKER/USDC` concentrated liquidity.

**Phase decision (ADR-001).** Do **not** build a CLMM from scratch in v1. Deploy on an audited existing CLMM (Orca Whirlpools or Raydium CLMM) and implement long-term orders as keeper-sliced execution against it. Building a novel CLMM *and* a novel N-asset AMM simultaneously doubles the audit surface for no user-visible gain.

Revisit in Phase 4: a native pool with in-kind TWAMM execution is meaningfully more efficient (no per-slice fee, no sandwich surface) and becomes worth the risk once volume justifies it. Write the ADR with this reasoning so the decision is revisitable rather than re-litigated.

### 5.4 `orders`

Three order types, one account layout, one crank.

**Long-term orders (TWAMM semantics).** A constant-rate order over a duration. Solana has no per-block hook, so execution is *lazy with closed-form catch-up*: the crank computes the exact state transition between `last_executed_slot` and the current slot in one step rather than iterating.

- Implement the closed-form solution from the TWAMM paper for constant-rate orders against constant product.
- Verify against a numerical ODE integrator in `reference/twamm.py` to ≤1e-9 relative error across a wide parameter sweep, including near-degenerate cases (one-sided flow, very short durations, very large rates relative to reserves).
- Bound state growth: order expiries snap to fixed intervals so the number of distinct expiry checkpoints stays small and the crank's work per call is O(intervals crossed), not O(orders).
- Anyone may crank; the cranker receives a fee from executed volume. Never make execution dependent on a single privileged keeper.

**Recurring buys.** Sugar over long-term orders: a schedule that opens a new long-term order per period. This is the primary retail product surface.

**NAV-banded conditional orders.** Execute only when `|pool_price − reference_NAV| ≤ band_bps`, where `reference_NAV` comes from Pyth. Required behaviour:

- If the equity market is closed (Pyth reports no current price), the order does not execute unless the user explicitly opted into off-hours execution.
- Pyth's confidence interval widens the band automatically — never treat the point estimate as exact.
- Stale price beyond `max_staleness` blocks execution entirely.

This is the mechanism that stops a user from silently buying a 4% weekend premium.

### 5.5 `baskets` (Phase 5)

Index and portfolio products over canonical tokens: weights, rebalance policy, fee accrual. Rebalances route through long-term orders rather than market orders — this is the whole reason TWAMM is in the stack, since basket rebalancing in thin books is exactly where naive execution bleeds.

---

## 6. Off-hours execution regime

When Pyth reports the equity market closed, the peg-keeping arbitrage loop is unavailable for most wrappers (Ondo's window closes Friday night to Sunday night; xStocks runs 24/5). Liquidity thins, and the token can move on sentiment with nothing anchoring it.

Three responses, in order of implementation:

1. **Dynamic fee.** Raise the Tier 2 fee tier during closed-market hours, parameterized by realized volatility and Pyth confidence. Simple, effective, ships first.
2. **LVF-informed guidance.** Use the Loss-Versus-Fair closed form to compute the expected cost of executing now versus waiting for market open, and surface it in the UI as a number, not a warning banner: *"Executing now costs an estimated 180bps versus Monday's open."* Implement in `reference/lvf.py` and expose through the pricing API.
3. **GDA fallback (Phase 4).** For wrappers where LP depth collapses off-hours, a gradual Dutch auction clears inventory at a continuous rate without requiring LPs willing to make markets — the specific property that makes GDA, rather than an AMM, the right off-hours mechanism.

---

## 7. Risk engine

### 7.1 Depeg detection

Continuously compute, per wrapper:

- `basis_bps = (wrapper_price_normalized − reference_NAV) / reference_NAV × 10000`
- rolling z-score of basis against a trailing window, segmented by market-open vs market-closed (their distributions are different; do not pool them)
- realized depth: USDC obtainable within 100bps, 300bps, 1000bps of mid

### 7.2 Circuit breakers

Graduated, on-chain, and **asymmetric** — a breaker may always restrict, and lifting always requires governance:

| Trigger | Action |
|---|---|
| basis beyond soft band, sustained | raise that wrapper's swap fee; flag in UI |
| basis beyond hard band, or depth collapse | `DepositsPaused` — no new deposits of that wrapper; `withdraw_single` disabled; `withdraw_proportional` stays open |
| issuer attestation stale beyond threshold | `DepositsPaused` + tier review |
| issuer/company transfer-void notice, or redemption suspension | `Frozen` — wrapper excluded from swap routing; proportional withdrawal only |

The PreStocks case is the design target for the last row: the failure mode was legal, not technical, and arrived as a public notice hours before the price moved. The corporate-actions service must ingest issuer and company notices, and the runbook must allow a human to trigger `Frozen` in minutes.

### 7.3 Exposure caps

`max_weight_bps` per wrapper, enforced at deposit. Tier 1 issuers get the highest caps. No single wrapper should ever be able to reach 100% of a pool — the whole point of the basket is that one issuer failing is a haircut, not a wipeout. Document the loss-mutualization behaviour prominently in the app; users must understand that the canonical token socializes wrapper risk in exchange for depth.

---

## 8. Off-chain services

### 8.1 `indexer`

Yellowstone gRPC (Geyser) subscription to program accounts and transactions → TimescaleDB. Must be replayable from genesis of the program deployment; keep a checkpointed cursor and support full rebuild. Every derived number the API serves must be reconstructible from chain state alone.

### 8.2 `pricing`

- Pyth Hermes for reference prices; handle market-closed and stale states explicitly as enum variants, never as null.
- Compute canonical NAV, per-wrapper basis, and pool mid.
- Serve LVF estimates.
- Publish a signed price snapshot feed for clients that want to verify.

### 8.3 `corpactions`

Ingest multiplier changes, dividend distributions, splits, and issuer notices per wrapper. Feeds `update_shares_per_token`. Requires a human-in-the-loop approval step for any discrete action above a delta threshold — this is the highest-consequence write in the system.

### 8.4 `keeper`

Cranks long-term and conditional orders. Must be:

- **Permissionless in design.** Run a first-party keeper, but ensure any third party can run one and be paid. Publish the keeper as open source.
- **Idempotent.** Double-cranking must be a no-op, not a double-execution.
- **Priority-fee aware.** Budget dynamically; alert on sustained inclusion failure.

### 8.5 `api`

REST + WebSocket. Endpoints for quotes, positions (denominated in shares, not tokens), order management, basis and NAV series, and pool composition. The pool composition endpoint is a trust surface — publish the full wrapper breakdown, tiers, and caps openly.

---

## 9. Frontend

Next.js. Principles:

- **Positions are denominated in shares and dollars, never in wrapper token counts.** The user owns NVDA exposure; the basket is an implementation detail they can inspect but never have to reason about.
- **Show basis on every trade.** Before confirmation: reference price, execution price, basis in bps, and in dollars. After fill: a receipt showing realized basis.
- **Disclose the basket.** One tap from any position to the wrapper composition with issuer tiers and caps. Do not hide the risk you are mutualizing.
- **Market-state is always visible.** Open / closed / off-hours, with what that means for execution.
- Recurring buys and baskets are the primary surfaces. Single trades are secondary.

Consult `/mnt/skills/public/frontend-design/SKILL.md` before starting UI work.

---

## 10. Testing and security

**Non-negotiable bars before mainnet:**

1. Differential tests: Rust vs Python reference for every math module, ≥10⁶ cases each.
2. Fuzzing: `cargo-fuzz` or Trident on all instruction handlers, 72h clean run minimum.
3. Invariant tests: every property in §5.2 as a stateful property test.
4. Mainnet-fork integration tests against real wrapper mints, including transfer-hook paths.
5. Two independent audits from firms with Solana AMM experience. One must specifically cover the Orbital implementation, since it is novel code with no prior production deployment to compare against.
6. A public testnet period with real wrappers and capped TVL, minimum 8 weeks.
7. Incident runbooks, rehearsed: wrapper freeze, oracle failure, keeper outage, normalization authority compromise.

**Explicit non-goals for v1:** cross-chain, leverage, perps, pre-IPO assets, anything requiring custody of user funds outside program PDAs.

---

## 11. Phases

Each phase ends with a written ADR and a demo against real mainnet wrapper mints on a fork.

**Phase 0 — Investigation (2–4 weeks).** §3 deliverables. Go/no-go on architecture.

**Phase 1 — Foundations.** `registry` program; normalization oracle service; indexer; pricing service with Pyth integration including market-hours and staleness handling. Deliverable: a public, accurate, real-time basis dashboard for every wrapper on Solana. This ships standalone, is useful on its own, and establishes credibility before any pooled funds exist.

**Phase 2 — Parity Pool.** `reference/orbital.py`, then `parity_pool`, then canonical mints for the three deepest underlyings. Audit gate.

**Phase 3 — Quote Pool + basic execution.** Deploy Tier 2 on an existing CLMM. Ship swaps, NAV-banded orders, and the app. Audit gate.

**Phase 4 — Long-term orders.** `reference/twamm.py`, then `orders`. Recurring buys ship here — this is the first genuinely retail product. Consider native TWAMM pool per ADR-001. GDA off-hours fallback.

**Phase 5 — Baskets.** Index and portfolio products with TWAMM rebalancing.

**Phase 6 — Distribution.** SDK, router integrations, wallet partnerships. The canonical tokens are more valuable as a standard than as an app.

---

## 12. Success metrics

- Depth at 100bps for `pTICKER/USDC` versus the sum of depth at 100bps across all individual wrapper pairs. **If the consolidated book is not deeper than the fragmented ones, the core thesis is wrong** — measure this from Phase 3 and be honest about it.
- Median realized basis on user fills versus median basis of a naive same-size market order in the deepest single wrapper.
- Share of off-hours volume executing inside the NAV band.
- Wrapper diversity within pools (no pool dominated by one issuer).
- Third-party integrations routing to canonical tokens.

---

## 13. Instructions for Claude Code

- **Start at Phase 0.** Produce the three `docs/findings/` documents before writing any program code. If Phase 0 invalidates the architecture, say so loudly rather than building around the problem.
- **Python reference first, always.** For every math module, the Python arbitrary-precision implementation is the source of truth. Rust is verified against it. Never write the Rust first.
- **Do not derive the Orbital or TWAMM math from memory.** Fetch the papers. If a formulation is ambiguous, write an ADR and take the pool-favouring reading.
- **No floating point in program code.** Every rounding decision explicit and directional.
- **Ask before adding a dependency** to any program crate. Audit surface is the scarce resource.
- **Write the ADR before the code** for any decision this document leaves open.
- When you disagree with something in this spec, say so and argue the case. This document is a starting position, not a contract.