# Finding 0.5 — Is there a fragmented market to consolidate?

**Status:** complete · **Verdict:** ⚠️ **The premise in §1 does not hold today.** The Solana tokenized-equity market is not fragmented across issuers — it is an xStocks near-monopoly.

| | |
|---|---|
| Scope | 18 underlyings × 3 vetted issuers |
| Observed | mainnet + Jupiter/DexScreener, 2026-09-12 (US market closed) |
| Reproduce | `node tools/phase0/wrapper-census.js`, `node tools/phase0/depth-fragmentation.js` |
| Raw evidence | [`evidence/wrapper-census-20260912.txt`](evidence/wrapper-census-20260912.txt) |

This finding was not requested by §3. It was added because the first three investigations kept surfacing the same thing — Ondo wrappers with no routable liquidity — and §1's central claim is empirical and cheap to test. The spec says to say so loudly if Phase 0 invalidates the architecture. This is that.

---

## 1. The number

Across 18 underlyings with **$18.0M** of total on-chain pool liquidity, only **$674k — 3.7% — sits outside the deepest wrapper for its underlying.**

That 3.7% is the entire addressable consolidation. It is the honest upper bound on what Tier 1 can deliver in depth terms today.

And **$661k of that $674k is a single underlying: SPCX (SpaceX)**, which §10 lists as an explicit v1 non-goal (pre-IPO).

**Excluding SPCX: $16.3M of liquidity, $13k consolidatable — 0.08%.**

## 2. The census

xStocks holds the deepest book in **all 18** underlyings, with ≥95% of pool liquidity in every one and exactly 100% in seven.

| Ticker | Wrappers | Total liq | Deepest share | Consolidatable |
|---|---|---|---|---|
| **SPCX** | 3 | $1.7M | 60.6% (xStocks) | **$661k** |
| SPY | 2 | $5.2M | 99.8% | $9k |
| META | 2 | $287k | 99.6% | $1k |
| AAPL | 2 | $891k | 99.9% | $892 |
| NVDA | 2 | $2.0M | 100.0% | $482 |
| AMD | 2 | $9k | 95.0% | $462 |
| AVGO | 2 | $53k | 99.5% | $285 |
| QQQ | 2 | $1.8M | 100.0% | $259 |
| CRCL | 2 | $2.1M | 100.0% | $207 |
| AMZN | 2 | $200k | 99.9% | $183 |
| PLTR | 2 | $154k | 99.9% | $125 |
| MSFT | 2 | $403k | 100.0% | $118 |
| GOOGL | 2 | $319k | 100.0% | $23 |
| TSLA, COIN, HOOD, MSTR, NFLX | 2 each | $2.9M | 100.0% | $0 |

Wrappers are identified by **mint authority**, not symbol — the three vetted keys from [`token-extensions.md`](token-extensions.md) §2. Symbol matching alone attributes impostors and unrelated tickers to the wrong underlying.

## 3. §1's worked example is inverted

The spec states:

> Circle's ~$171M of tokenized market cap is split across CRCLON (~$130M) and CRCLX (~$41M) — two shallow books on the same chain instead of one deep one.

Observed on 2026-09-12:

| | CRCLx (xStocks) | CRCLon (Ondo) |
|---|---|---|
| Mint | `XsueG8Bt…p3bd1` | `6xHEyem9…5ondo` |
| Market cap | **$75.1M** | **$656k** |
| Pool liquidity | **$2.12M** | **$207** |
| Holders | 17,392 | 80 |

CRCLx is **~114× larger by market cap and ~10,000× larger by pool liquidity.** The spec has the ratio not merely stale but reversed, and the absolute figure ($171M combined) is roughly 2.3× the observed total.

This does not mean the spec was written carelessly — Ondo may well have led on another chain, or at another time. It means **§1's numbers must be re-sourced before they are repeated in any external material.** Repeating them in a pitch or a grant application would be a factual error that a knowledgeable reader would catch immediately.

## 4. Ondo has market cap but no on-chain float

The pattern is consistent across all 18: Ondo wrappers have non-trivial market caps ($37k–$3.9M) and hundreds of holders, but essentially **zero routable liquidity**. Jupiter returns `NO_ROUTES_FOUND` for NVDAon, AAPLon, TSLAon and SPCXon at any size.

The likely reading — to be confirmed, not assumed — is that Ondo's product is **issuer mint/redeem, not DEX trading**. CRCLon shows $648k of 24h volume against $207 of pool liquidity, which is not a DEX pattern. Ondo tokens appear to be held and redeemed rather than traded.

If that is right, it has a sharp consequence: **there is no fragmented order flow between xStocks and Ondo to consolidate, because Ondo's users are not trading on-chain in the first place.** Tier 1 would be pooling a liquid asset with an illiquid one and calling the result depth.

## 5. Where the thesis does hold: SPCX

SPCX is the one genuine head-to-head:

| Wrapper | Issuer | Market cap | Pool liquidity | Share | 24h volume | Holders |
|---|---|---|---|---|---|---|
| SPCXx | xStocks | $84.2M | $1.0M | 60.6% | $3.0M | 27,256 |
| SPCX | Backpack | $6.5M | $661k | 39.4% | $1.7M | 18,121 |
| SPCXon | Ondo | $196k | $50 | 0.0% | $56 | 428 |

Two real books, two real user bases, a 61/39 split, and $4.7M of combined daily volume. This is precisely the market §1 describes — and it is the *only* one in the set.

It is also pre-IPO SpaceX, excluded from v1 by §10, with a `ScaledUiAmount` multiplier pinned at 1.0 on all three wrappers so it exercises none of the normalization machinery ([`normalization-sources.md`](normalization-sources.md) §2).

**The one underlying where the product thesis is demonstrably true is the one underlying the spec forbids v1 from touching.** That tension has to be resolved deliberately, not by accident.

## 6. Measured depth, off-hours

Routable depth is measured the way a user experiences it — binary-search the USDC notional whose routed Jupiter quote incurs a given price impact — rather than from headline TVL, which overstates concentrated liquidity parked outside the traded range.

Measured 2026-09-12, **US equity market closed** (so these are off-hours books, the regime §6 targets):

| Wrapper | @100bps | @300bps | @1000bps |
|---|---|---|---|
| NVDAx | $278k | $547k | $913k |
| AAPLx | $95k | $178k | $229k |
| SPCX (Backpack) | throttled | **$518k** | throttled |
| SPCXx (xStocks) | $32k | **$248k** | $443k |
| SPCXon (Ondo) | throttled | throttled | throttled |
| NVDAon, AAPLon, TSLAon | no route | no route | no route |

Jupiter's free tier exhausted its quota mid-run, so several cells report
`THROTTLED` — which the tool surfaces as such rather than as zero depth. An
earlier run reported SPCX as "no route" for exactly this reason; that was wrong
and is fixed. A complete series needs a paid quote tier.

**The 300bps row is complete for both real SPCX books, and it is the single most
useful measurement in Phase 0:**

| | Backpack SPCX | xStocks SPCXx |
|---|---|---|
| Headline pool liquidity | $661k (39.4%) | $1.0M (60.6%) |
| Routable depth @300bps | **$518k** | **$248k** |

Two things follow.

**Headline TVL misranks the books.** Backpack holds ~two-thirds of xStocks'
headline liquidity but offers **2.1× the routable depth** at 300bps. Concentrated
liquidity placement dominates notional TVL. Every liquidity comparison in this
document that rests on the census (§2–§5) is therefore a *share* measure, not a
depth measure, and §12's metric #1 must be measured by routed depth — as here —
not by TVL.

**On the one underlying where fragmentation is real, consolidation is worth
roughly half again as much depth.** A user trading SPCX today reaches at most
**$518k** at 300bps in the best single book. Consolidated, the two books sum to
**$766k** — a **+48%** improvement for a user who currently has to pick a side.

That is the thesis working, measured, on real books. It applies to exactly one
underlying in the set, and that underlying is pre-IPO SpaceX.

Two observations:

- Even the deepest single wrapper is thin: **$278k moves NVDAx 100bps off-hours.** A $1M off-hours order is a ~10% impact event. The off-hours problem in §6 is real and larger than the fragmentation problem.
- The dominant NVDAx venue routed by Jupiter is an oracle-quoting AMM ("Riptide") which intermittently returns `market oracle is stale` during off-hours. Given [`oracle-coverage.md`](oracle-coverage.md), that is almost certainly the same abandoned Pyth equity feed. **A large share of headline off-hours depth is quoted off a stale oracle and may vanish exactly when it is needed.**

## 7. What this means for the plan

The plan is not dead. But its **stated** value proposition — consolidating fragmented depth — is not supported by current data, while two of its **secondary** propositions are strongly supported.

**Weakly supported today:**
- Tier 1 N-asset parity pooling across issuers (§5.2). There is $13k of non-SPCX liquidity to consolidate. This is the largest and riskiest piece of novel code in the plan — a from-scratch Orbital implementation with no prior production deployment, requiring a dedicated audit (§10.5) — aimed at the smallest measured problem.
- §12's headline metric. Consolidated depth would beat the sum of fragmented books trivially, because there is only one book.

**Strongly supported by the same data:**
- **Off-hours execution (§6).** $278k at 100bps on the deepest name, with oracle-quoted venues going stale. This is the largest measured user harm in the dataset.
- **The basis dashboard (Phase 1).** Nobody can currently compute an honest basis for these tokens — Hermes is credentialed and the on-chain equity feeds are weeks stale ([`oracle-coverage.md`](oracle-coverage.md)). A working, public, real-time basis and depth dashboard is genuinely absent infrastructure, ships standalone, and §11 already sequences it first.
- **Instrument-risk disclosure (§1.4, §7).** Impostor mints with identical names are live right now ([`token-extensions.md`](token-extensions.md) §6), and every vetted wrapper carries issuer powers — permanent delegate, global pause, freeze — that no UI surfaces.

### Recommendation

**Proceed with Phase 1 exactly as written, and do not commit to Phase 2 until Phase 1 data justifies it.**

Phase 1 (`registry`, indexer, pricing, basis dashboard) is unaffected by this finding — it is arguably *more* valuable given the oracle gap — and §11 already positions it as shipping standalone and establishing credibility before pooled funds exist. It also produces exactly the time series needed to decide Phase 2 on evidence: cross-issuer liquidity share over time, realized off-hours basis, and whether any second issuer gains share.

Before committing to the Orbital implementation, one of these should be true:

1. A second issuer reaches ≥15% liquidity share on a non-pre-IPO underlying, or
2. SPCX-class pre-IPO assets are brought into v1 scope deliberately, with the legal review in §0.3 covering them, or
3. Tier 1 is re-scoped from *consolidating existing fragmentation* to *being the venue new issuers list into* — a real strategy, but a distribution bet rather than a liquidity-consolidation one, and it should be argued on those terms.

Reordering to put off-hours execution and the risk/disclosure layer ahead of Tier 1 would also track the measured harm more closely than the current phase order does. That is a larger change than this finding alone justifies, and it is flagged for discussion rather than recommended outright.

## 8. Caveats

- **One snapshot, taken on a Saturday with US equity markets closed.** Off-hours liquidity is structurally thinner than during the session. Depth figures are lower bounds on weekday depth; the *shares* in §2 are much less time-sensitive but should be re-measured during a session before any decision rests on them.
- Liquidity figures come from Jupiter and DexScreener aggregation and cover routable AMM pools. Issuer mint/redeem, CEX books (Kraken, Bybit, Backpack) and OTC flow are **not** counted. If Ondo's depth lives on a CEX, cross-issuer fragmentation is real at the *market* level even though it is invisible on-chain — but it is then also not addressable by an on-chain pool.
- 18 underlyings, chosen as the highest-profile US names plus the tickers §1 cites. xStocks lists 60+ and Ondo 100+; the long tail is unmeasured and could plausibly contain underlyings where Ondo leads.
- Only three issuers are vetted. The census cannot see an issuer whose mint authority we have not identified.

## 9. Open items

- [ ] Re-run during a US session (Mon–Fri 13:30–20:00Z) and compare. `wrapper-census.js` and `depth-fragmentation.js` both take `TICKERS=`.
- [ ] Extend the census to the full xStocks and Ondo listings to test the long tail.
- [ ] Identify and vet any fourth issuer (Backed's other lines, Swarm, Dinari, Remora) and add their mint authorities.
- [ ] Establish where Ondo liquidity actually is — CEX, issuer redemption, or simply absent. Decides whether §4's reading is right.
- [ ] Re-source §1's CRCL figures, or strike them.
- [ ] Confirm the identity of the "Riptide" venue and whether its oracle is the stale Pyth equity feed.
