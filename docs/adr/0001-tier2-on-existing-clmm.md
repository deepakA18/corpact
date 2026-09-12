# ADR-001 — Deploy Tier 2 on an existing audited CLMM

**Status:** Accepted (restated from spec §5.3) · **Date:** 2026-09-12

## Context

§5.3 already makes this decision. It is recorded here because §5.3 asks for it to be written up "so the decision is revisitable rather than re-litigated", and because Phase 0 surfaced a new constraint the original reasoning did not account for.

## Decision

Do not build a CLMM from scratch for v1. Deploy `pTICKER/USDC` on Orca Whirlpools or Raydium CLMM, and implement long-term orders as keeper-sliced execution against it.

## Reasoning

As stated in §5.3: building a novel CLMM *and* a novel N-asset AMM simultaneously doubles the audit surface for no user-visible gain.

Phase 0 strengthens this considerably. [`liquidity-fragmentation.md`](../findings/liquidity-fragmentation.md) finds ~3.7% of on-chain liquidity is consolidatable and ~98% of that is a single pre-IPO underlying. With the Tier 1 premise itself in question, spending audit budget on a second novel AMM is clearly wrong.

[`token-extensions.md`](../findings/token-extensions.md) §3 also confirms the venues are viable hosts: Raydium CLMM and Meteora DLMM pool PDAs already custody Token-2022 wrappers with `PausableAccount` and `TransferHookAccount` extensions, at size, today.

## New constraint from Phase 0

**`pTICKER` must not be a rebasing token.**

[`normalization-sources.md`](../findings/normalization-sources.md) §8 shows that third-party CLMMs price raw balances and are not `ScaledUiAmount`-aware. When an issuer steps a multiplier, the economic value of a pool's reserve jumps while its quoted price does not — a free arbitrage against every LP, at every step. This is happening in Raydium, Orca and Meteora pools right now.

If `pTICKER` carried its own `ScaledUiAmountConfig` — option 2 in `normalization-sources.md` §7 — it would import that exact hazard into Tier 2. **ADR-001 and a rebasing `pTICKER` are mutually exclusive.** Whichever survives must be chosen deliberately.

This constraint did not exist in §5.3's original reasoning and is the main reason to record this ADR rather than rely on the spec text.

## Revisit when

§5.3's trigger stands: a native pool with in-kind TWAMM execution is meaningfully more efficient (no per-slice fee, no sandwich surface) and becomes worth the risk once volume justifies it. Phase 4.

Add one trigger: if the accrual-surplus decision resolves toward rebasing `pTICKER`, reopen this immediately — a rebasing token on a non-rebase-aware CLMM is a standing, quantifiable leak, not a design preference.

## Consequences

- Tier 2 audit surface is the integration, not an AMM.
- Long-term orders pay per-slice fees and carry sandwich surface until Phase 4.
- `pTICKER` design is constrained: non-rebasing, standard SPL or minimal Token-2022.
- The accrual surplus must be handled in `parity_pool`, not in the token.
