# ADR-002 — Read normalization from `ScaledUiAmountConfig`, not from a Parity oracle

**Status:** Accepted · **Date:** 2026-09-12 · **Supersedes:** spec §5.1 `update_shares_per_token`

## Context

§5.1 specifies a permissioned `update_shares_per_token` instruction: a Parity-controlled oracle authority writes each wrapper's `shares_per_token` into `registry`, guarded by a per-update delta bound, an attestation hash, and a swap pause on large deltas. §0.2 calls this "the single greatest source of value leakage in this design."

[`normalization-sources.md`](../findings/normalization-sources.md) establishes that the scalar is already on-chain. All eight candidate wrappers carry a Token-2022 `ScaledUiAmountConfig` whose multiplier *is* `shares_per_token`, written by the issuer, readable in the same account load as the balance.

## Decision

**Read the multiplier live from the wrapper mint account inside every instruction that values a wrapper.** Do not cache it in `registry` as the authoritative value. Do not build a Parity-side normalization oracle.

Specifically:

1. `parity_pool` takes each participating wrapper **mint** as a required account on swap, deposit and withdrawal.
2. Normalization is computed per instruction as `shares = raw_base_units × multiplier / 10^decimals`, composed into a single `Q64.64` scalar so no call site can omit the decimals term.
3. `registry.Wrapper` stores a **last-known-good** scalar plus bounds. On each read, `parity_pool` compares live against last-known-good and **halts the pool** if the delta exceeds the configured bound. The delta guard moves from the write path to the read path.
4. `update_shares_per_token` is removed. `registry` gains `ratify_shares_per_token`, a governance action that advances last-known-good after a corporate action is reviewed — it authorises nothing, it only acknowledges.
5. `f64 → Q64.64` conversion is done on raw bits with integer arithmetic. Multipliers outside `[2⁻¹⁶, 2¹⁶]`, or non-finite, or subnormal, are **rejected**, never rounded.

## Reasoning

**Caching is provably unsafe against at least one live issuer.** [`normalization-sources.md`](../findings/normalization-sources.md) §3 shows Ondo writes `multiplier` and `new_multiplier` to the same value with an irregular effective timestamp — the new scalar takes effect in the slot it is written, with zero advance notice. Any cached value is stale from that slot until an indexer reacts. §5.1's design — observe, then pause — cannot outrun a same-slot step.

**The value at stake is concrete.** The NVDAx step on 2026-09-10 moved the scalar +7.82 bps: $16.54 per 100 shares, ~$827 on a 5,000-share pool, free to the first arbitrageur across an unrepriced pool.

**It removes our largest trusted component.** A Parity-held oracle authority that can rewrite every wrapper's valuation is the highest-value key in the system. Deleting it removes an attack surface, an operational burden, and a governance question. §8.3 `corpactions` drops from "the highest-consequence write in the system" to a monitoring service with no write authority at all.

**The delta bound still works — on the other side.** §5.1's instinct to bound per-update deltas is right; it was simply pointed at the wrong path. We are not in the write path and never will be. Bounding the *read* gives the same protection against a compromised or fat-fingered issuer authority, and additionally protects against an issuer we do not control at all.

## Rejected alternatives

**Cache in `registry`, update via keeper.** Rejected: loses the race against same-slot updates, for no gain. A cached read is not meaningfully cheaper than loading a mint we must load anyway to transfer the token.

**Cache, and pause on divergence detected off-chain.** Rejected: the pause lands after the arbitrage. Detection latency is the leak.

**Use the issuer APIs described in §0.2.** Rejected: strictly worse than the on-chain value in latency, trust and availability. The on-chain value is what the token program itself enforces.

**`as f64` cast in the program.** Rejected: violates §4.2's no-floating-point rule, and is non-deterministic risk for no benefit. The bit-level lift is exact for the admissible range — verified across all observed multipliers.

## Consequences

**Good:**
- No Parity normalization authority to compromise, operate or govern.
- No staleness window at all — the value read is the value the token program enforces.
- `corpactions` becomes monitoring-only.
- Fewer moving parts on the highest-consequence path in the system.

**Costs:**
- Every wrapper-touching instruction carries an extra account. On an N-asset pool this pressures the transaction account limit and is a hard constraint on N. **This bounds the practical size of a Parity Pool and must be measured before the Orbital implementation is scoped.**
- Compute cost of TLV extension parsing per instruction. Needs benchmarking.
- We inherit issuer error directly: a wrong multiplier is immediately live, with the read-path bound as the only defence.
- The bound must be sized against real corporate actions. A 10:1 stock split is a 10× move, not 8 bps — the bound cannot be tight enough to catch a fat finger without also halting on legitimate splits. **Splits must be a governance-ratified pause-and-resume path, not an anomaly to reject.**

## Open

- Accrual surplus disposition ([`normalization-sources.md`](../findings/normalization-sources.md) §7) — separate ADR, blocks `parity_pool`.
- Direction of the multiplier must be proven on a fork before pool math is written. An inverted scalar is a silent, total mispricing.
- Maximum N for a Parity Pool given the account-limit constraint above.
