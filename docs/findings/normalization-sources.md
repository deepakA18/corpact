# Finding 0.2 — Share normalization sources

**Status:** primary question answered · **Verdict:** the spec's normalization oracle should not be built. The scalar is already on-chain.

| | |
|---|---|
| Scope | 8 wrapper mints, 3 issuers |
| Observed | mainnet, 2026-09-12 |
| Reproduce | `node tools/phase0/decode-scaled-ui.js`, `node tools/phase0/multiplier-history.js` |

---

## 1. Headline

§0.2 asks us to locate, per wrapper, "a `shares_per_token` scalar: how many underlying shares one token currently represents", and warns that this oracle is "the single greatest source of value leakage in this design".

**All eight wrappers carry a `ScaledUiAmountConfig` Token-2022 extension, and its multiplier is that scalar.** It lives on the mint account, is written by the issuer, and is read in the same account load as the balance. There is no API to poll, no attestation to verify, no latency to bound, and no permissioned Parity-side authority to compromise.

This deletes the largest single piece of trusted off-chain infrastructure from the design. See [ADR-002](../adr/0002-normalization-from-scaled-ui-amount.md).

## 2. Observed values

`ScaledUiAmountConfig` holds `multiplier`, `new_multiplier` and `new_multiplier_effective_timestamp`. The active scalar is `new_multiplier` once the effective timestamp has passed, `multiplier` before.

| Wrapper | Dec | Active multiplier | Effective at | Staged value pending? | Multiplier authority |
|---|---|---|---|---|---|
| NVDAx | 8 | 1.001701196801074 | 2026-09-10 00:30:00Z | no (elapsed) | `S7vYFFWH…JuRaS` |
| NVDAon | 9 | 1.0017152487959897 | 2026-09-10 00:04:05Z | no | `9foMHsSD…5cUxD` |
| AAPLx | 8 | 1.0032690125398187 | 2026-08-08 00:30:00Z | no (elapsed) | `S7vYFFWH…JuRaS` |
| AAPLon | 9 | 1.003376073740221 | 2026-09-02 10:14:04Z | no | `9foMHsSD…5cUxD` |
| TSLAon | 9 | 1.0 | 2026-09-02 10:14:04Z | no | `9foMHsSD…5cUxD` |
| SPCX | 6 | 1.0 | (unset) | no | `HK6jF79d…KcXctZ` |
| SPCXx | 8 | 1.0 | (unset) | no | `S7vYFFWH…JuRaS` |
| SPCXon | 9 | 1.0 | 2026-09-02 10:14:04Z | no | `9foMHsSD…5cUxD` |

### The divergence the product exists to close, measured

| Pair | Ratio | Divergence |
|---|---|---|
| NVDAx → NVDAon | 1.000014028130 | **+0.14 bps** |
| AAPLx → AAPLon | 1.000106712356 | **+1.07 bps** |
| SPCXx → SPCXon / SPCX | 1.000000000000 | 0.00 bps |

This is the real, current, measured non-fungibility between one issuer's token and another's for the same company. It is **small** — one to two thousandths of a percent — and the spec's framing ("one xStock token and one Ondo token are not the same claim on the same number of shares") should be read as directionally true but numerically minor *today*.

Two honest observations follow:

- The divergence is monotonic and cumulative. It is dividend accrual; it never mean-reverts. AAPL, the higher-yielding name, has diverged 7.6× further than NVDA. Over years this becomes material; over a quarter it does not.
- **Normalization is not what makes this product worth building — depth consolidation is.** A user trading NVDAx versus NVDAon today loses ~0.14 bps to non-fungibility and, per [`liquidity-fragmentation.md`](liquidity-fragmentation.md), far more to thin books. The pitch should lead with the book, not the multiplier. Getting normalization right is table stakes that prevents a leak; it is not the source of the value.

### What "SPCX-family multiplier = 1.0" means

SpaceX is pre-IPO and pays no dividend, so there is nothing to accrue and all three wrappers sit at exactly 1.0. This is why SPCX is a poor first pool despite having three competing wrappers: it exercises the depth thesis but not the normalization machinery at all.

## 3. Update mechanics differ by issuer, and it matters

Two distinct patterns are visible in the state itself:

**xStocks — staged activation.** `multiplier` ≠ `new_multiplier`, and effective timestamps land on exactly `00:30:00Z`. Round timestamps mean the activation instant is chosen, not incidental. A scan of the ±15 minute window around the NVDAx activation (2026-09-10 00:30:00Z) found 21 signatures from the multiplier authority and **no `UpdateMultiplier` instruction**, confirming the write landed outside that window — i.e. the value was staged ahead of its effect.

**Ondo — immediate effect.** `multiplier` == `new_multiplier` on every Ondo mint, and effective timestamps are irregular to the second (`00:04:05Z`, `10:14:04Z`). Both fields are overwritten at write time, so the new scalar takes effect in the same slot it is written. **There is no advance notice whatsoever.**

Backpack has never moved its multiplier off 1.0 (`effective_at` is unset), so its pattern is unobserved.

### Why this decides the design

§5.1 specifies `registry.update_shares_per_token` as a permissioned write that can "pause swaps on affected pools for a configured settlement window when the delta exceeds a threshold". That works against xStocks' staged pattern and **cannot work against Ondo's**: by the time an indexer observes the write, the step has already taken effect and the pool has already been arbitrageable for however many slots it takes to react.

The only sound response is to **read the multiplier live from the mint account inside the swap instruction** rather than caching it in `registry` state. The mint must be a required account on every `parity_pool` instruction that touches a wrapper. Cached normalization is a guaranteed leak against the immediate-effect issuer.

## 4. Value at stake per step

The NVDAx activation on 2026-09-10 moved the scalar from `1.0009180758490996` to `1.001701196801074` — a step of **+7.82 bps**.

At an NVDA reference of ~$211, that is **$16.54 per 100 shares**, free to the first party to trade across the step against a pool that had not repriced. For a pool holding 5,000 normalized shares, a single missed step is roughly **$827** transferred from LPs to an arbitrageur.

That is the concrete cost of getting §3 wrong, and the concrete value of reading the mint live.

## 5. Fixed point: `f64` on the mint vs. the spec's no-floating-point rule

`ScaledUiAmountConfig.multiplier` is an **IEEE-754 `f64`**. §4.2 bans floating point in program code. These are reconcilable, but only deliberately.

An `f64` is dyadic: mantissa × 2^exp. Lifting it to `Q64.64` is **exact** whenever the value needs no more than 64 fractional bits. For a multiplier near 1.0 the mantissa LSB is 2⁻⁵², comfortably inside that budget. Verified over the observed set:

| Wrapper | `f64` bits | `Q64.64` value | Round-trip error |
|---|---|---|---|
| NVDAx | `0x3ff006f7d589fea9` | 18478125615717978112 | < 1e-39 |
| NVDAon | `0x3ff007069197bb83` | 18478384829271912448 | < 1e-39 |
| AAPLx | `0x3ff00d63cedf2e05` | 18507046711405334528 | < 1e-39 |
| AAPLon | `0x3ff00dd411e4d9a3` | 18509021641969381376 | < 1e-39 |
| TSLAon / SPCX / SPCXx / SPCXon | `0x3ff0000000000000` | 18446744073709551616 | exact (0) |

(The residuals above are artefacts of the 40-digit decimal harness, not of the lift.)

**The conversion must be done on the raw bits with integer arithmetic — never by an `as f64` cast.** Decompose sign/exponent/mantissa from the `u64`, shift into `Q64.64`, and **reject** any multiplier outside a safe band rather than rounding it. Proposed admission band: `[2⁻¹⁶, 2¹⁶]`, non-negative, finite, non-subnormal. Everything observed sits within `[1.0, 1.004]`.

## 6. Decimals must be folded into normalization

Wrapper decimals are **not uniform**: 6 (Backpack), 8 (xStocks), 9 (Ondo). The spec's `normalized = raw_balance × shares_per_token` is therefore incomplete. The correct relation is:

```
shares = raw_base_units × multiplier / 10^decimals
```

The same billion base units means wildly different things across issuers:

| Wrapper | Dec | 1e9 base units = |
|---|---|---|
| SPCX | 6 | 1,000.000000 shares |
| SPCXx | 8 | 10.000000 shares |
| NVDAx | 8 | 10.017012 shares |
| NVDAon | 9 | 1.001715 shares |

A three-orders-of-magnitude error is available to anyone who reads the spec's formula literally. `registry.Wrapper.shares_per_token` should store a **single composed scalar** `multiplier / 10^decimals` in `Q64.64`, computed once per read, so no call site can forget the decimals term.

## 7. The accrual surplus — an unresolved gap in §5.2

§5.2 defines `deposit(wrapper, amount) → mints amount × shares_per_token of pTICKER`. So `pTICKER` is denominated in shares and its supply is fixed at mint time.

But the wrappers backing it keep accruing. When a multiplier steps up, the pool's normalized share count rises while `pTICKER` supply does not. The pool accumulates a **surplus of shares over claims**, growing at roughly each wrapper's dividend yield.

The spec never says where that surplus goes. Three options, none free:

1. **Accrue to LPs** as an increase in the Orbital invariant's `R`. Simple, consistent with "the invariant is non-decreasing", but means `pTICKER` holders donate their dividends to LPs — indefensible for a token marketed as one share of exposure.
2. **Rebase `pTICKER`** by giving it its own `ScaledUiAmountConfig`. Economically correct and symmetric with the wrappers. But it makes `pTICKER` a rebasing token, which re-imports the exact AMM hazard described in §8 into every downstream integration — the opposite of §12's "valuable as a standard" goal.
3. **Periodic surplus sweep** into a distribution or a fee pool, at a governance cadence.

This must be decided before `parity_pool` is written; it changes what `pTICKER` *is*. Recommend option 3 for v1: it keeps `pTICKER` non-rebasing (preserving integration value) and makes the accrual explicit and auditable rather than silently redistributive. Written up as an open ADR.

## 8. Third-party AMMs holding these wrappers are structurally leaky

A consequence worth recording because it bears on ADR-001. Raydium, Orca and Meteora price raw balances and are not `ScaledUiAmount`-aware. When an issuer steps a multiplier, the economic value of a pool's raw reserve jumps while its quoted price does not — a free arbitrage against every LP in every third-party pool, at every step, today.

Two implications:

- This is a genuine, measurable edge for Parity's Tier 1 design, and the strongest available argument for it. It is worth quantifying against historical steps in Phase 1 and publishing.
- ADR-001 puts Tier 2 (`pTICKER/USDC`) on an audited third-party CLMM. That is only safe **if `pTICKER` is non-rebasing** — reinforcing option 3 in §7. If `pTICKER` rebases, ADR-001 and §7 are in direct conflict.

## 9. Answers to §0.2's specific questions

- **xStocks — on-chain multiplier account or issuer API?** On-chain, on the mint, `ScaledUiAmountConfig`. Authority `S7vYFFWH…JuRaS`, separate from its transfer-policy authority. Updates are staged with a scheduled activation at `00:30:00Z`. No issuer API needed.
- **Ondo — published NAV/accrual source and cadence?** Same on-chain extension, authority `9foMHsSD…5cUxD` (shared with mint and hook authority). Updates take effect immediately on write. Observed AAPLon and NVDAon both updated within the last ten days; TSLAon and SPCXon share a single batch timestamp (`2026-09-02 10:14:04Z`), suggesting issuer-wide batched writes.
- **Backpack — redemption ratio source?** `ScaledUiAmountConfig`, authority `HK6jF79d…KcXctZ`. Pinned at 1.0 with `effective_at` unset; never updated. Update behaviour is unobserved and cannot be assumed.
- **Update latency?** Zero for Ondo (same-slot). Staged for xStocks, lead time not yet quantified — see open items.
- **Failure modes?** A wrong multiplier is a direct, unbounded theft from LPs, and it is now an *issuer* capability rather than a Parity one. We cannot bound it with a per-update delta check in our own authority, because we are not in the write path. The check must instead sit on the **read** path: `parity_pool` compares the live multiplier against a `registry`-recorded last-known-good value and halts the pool if the delta exceeds a bound. This inverts §5.1's design — the delta bound guards reads, not writes.

## 10. Consequences for the spec

1. **Do not build the normalization oracle service.** §8.3 `corpactions` shrinks from "the highest-consequence write in the system" to a monitoring and alerting service with no write authority at all. This is a large reduction in both attack surface and operational burden.
2. **§5.1 `update_shares_per_token` should not exist** as a permissioned write. Replace with a read-path delta guard. See ADR-002.
3. **`parity_pool` must take each wrapper mint as an account** on every swap, deposit and withdrawal.
4. **`shares_per_token` must compose the decimals term.** Store `multiplier / 10^decimals` as one `Q64.64`.
5. **`f64 → Q64.64` needs a dedicated, fuzzed, bit-level conversion** in the shared math crate, with an explicit rejection band. First unit of Rust to write.
6. **Resolve the accrual surplus question** before `parity_pool`.
7. Reframe the external pitch: depth first, normalization second.

## 11. Open items

- [ ] Quantify xStocks' staging lead time. Needs an archival RPC — public endpoints throttle and truncate signature history. Determines whether a scheduled pre-step pause is feasible or whether the read-path guard is the only defence.
- [ ] Confirm the direction of the multiplier empirically: is UI amount = shares (so `raw × multiplier` is the share count)? Consistent with observed DEX prices, but assumed, not proven. **Prove on a fork before writing pool math** — an inverted scalar is a silent, total mispricing.
- [ ] Confirm whether Jupiter/DexScreener quote per UI token or per raw token. Affects every basis number the Phase 1 dashboard publishes.
- [ ] Establish whether Backpack intends to use its multiplier at all. If SPCX is permanently 1.0, it needs no normalization path.
- [ ] Model worst-case step size from historical corporate actions (splits are the tail risk: a 10:1 split is a 10× scalar move, not 8 bps) and set the read-path delta bound from that distribution.
