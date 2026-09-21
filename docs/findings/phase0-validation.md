# Phase 0 - validation results

**Investigated:** 2026-09-13 · **Network:** Solana mainnet · **Plan:** [PLAN.md](../../PLAN.md) v2 §0 and §4
**Reproduce:** [`tools/validate/`](../../tools/validate/) · **Evidence:** [`evidence/demand-20260913.json`](evidence/demand-20260913.json)

| § | Check | Status | Verdict |
|---|---|---|---|
| 0.1 | Demand | ✅ Measured | **Borderline.** Many holders; material income for few. Decision needed - see below. |
| 0.2 | Regulatory boundary | ⛔ Not started | Needs securities counsel. Nothing here substitutes for it. |
| §4 | Feasibility spike | ✅ Mostly proven | The mechanic works on real data. Classification evidence exists and is good. Archival history is still open. |

---

## 0.1 Demand

**Question (PLAN §0.1):** how many real wallets received at least one dividend rebase on an xStock in the last year, and what was it worth?

| | |
|---|---|
| xStocks with a Solana deployment | 832 |
| …with ≥1 dividend-labelled activation, 2025-09-13 → 2026-09-13 | 342 |
| Distinct wallets currently holding one of those (program-owned excluded) | **220,228** |
| Median wallet's estimated yearly dividend value | **$0.0017** |
| p90 / p99 wallet | $0.053 / $4.88 |
| Wallets ≥ $1 / ≥ $10 / ≥ $100 per year | 4,912 / **1,443** / 344 |
| Wallet × event pairs | 1,370,669 - of which ≥ $1: 15,957; ≥ $10: 5,686 |
| Estimated total holder dividend value | ~$25M/yr, highly concentrated |

Holders concentrate in a handful of assets: 18 assets have ≥1,000 holders, 37 have ≥100, and the median dividend-paying asset has **6**.

| Asset | Holders | Wallet-events ≥ $10 | Est. holder income/yr |
|---|---|---|---|
| NVDAx | 88,613 | 244 | $108k |
| SPYx | 69,637 | 822 | $290k |
| QQQx | 37,302 | 331 | $148k |
| AAPLx | 32,423 | 105 | $124k |
| GOOGLx | 26,624 | 367 | $121k |
| STRCx | 4,349 | 1,032 | **$3.58M** (13 distributions; preferred) |

### Reading it against the go/no-go

PLAN §0.1 names two outcomes: *"a few hundred wallets, cents per event"* (stop) or *"thousands of wallets with material distributions"* (proceed). **The data is neither.** Tens of thousands of wallets receive rebases, but the typical one receives a fraction of a cent a year. Material income (≥ $10/yr) reaches about 1,400 wallets, and the top of that tier is likely exchange, market-maker and treasury wallets rather than individuals.

What that suggests, for the owner to decide:

- The mass-market "see your dividend income" pitch lands on wallets where the number is $0.00. That is not a product people return to.
- The real audience is small: roughly 1–5k wallets with meaningful income, concentrated in yield instruments (STRCx, STRKx, SATAx, TBLLx) and income equities (PFEx, CVXx, PEPx, MRKx).
- The legibility problem is real at every size, though. Tens of thousands of holders cannot see an event that changes their balance. That may make more sense as a wallet or exchange integration than as a standalone app.

### Refinement: who holds the income (2026-09-13)

Every wallet with ≥ $10/yr of estimated dividend value was profiled. Dividends here come from corporate-action `CashDividend` records, so spin-offs are excluded. All wallets were already plain keypairs, since program-owned accounts were excluded earlier. The buckets are behavioural heuristics, not identities ([evidence](evidence/wallet-profile-20260913.json), [script](../../tools/validate/wallet-profile.mjs)).

| Bucket (first match wins) | Wallets ≥ $10 | Est. $/yr | Wallets ≥ $100 | Wallets ≥ $10k |
|---|---|---|---|---|
| Issuer authority key named on a mint | 1 | **$19.17M** | 1 | 1 |
| High throughput (≥ 1,000 txs in ≤ 7 days) | 66 | $4.14M | 33 | 8 |
| Broad book (≥ 40 Token-2022 accounts or ≥ 25 dividend assets) | 34 | $0.41M | 11 | 2 |
| Plausibly individual | **1,212** | **$0.21M** | 272 | 1 |
| Profile failed (rate limits) | 68 | $0.01M | 13 | 0 |

- **~80% of the headline "$25M holder income" is one issuer-controlled wallet.** That is inventory, not a customer. Exchange-like and market-maker wallets hold most of the rest.
- **Individuals are many but small.** 1,212 plausible individuals share ~$208k/yr, a median of well under $100 each. Only 44 of them exceed $1,000/yr, and only 1 exceeds $10k.
- **Consequence:** a consumer dashboard has a real but tiny audience. The size is held by a few dozen institutional-looking wallets, which is the case for an accounting engine or API sold to exchanges and protocols rather than an app.

### Limits of the estimate

- **Current holders stand in for event-time holders.** No archival balance history was used.
- **On-curve exchange and market-maker wallets are counted as holders.** They inflate the upper tiers.
- **Values use the latest indicative price**, not the event-time price.
- **The scan used the multiplier-history `reason` field, which mislabels spin-offs as "Dividend"** (below). GMEx (13k holders), DFDVx (4.3k) and OPENx entered the 342 on that basis, so wallet counts are somewhat overstated.
- Five assets were rate-limited and re-run separately (6–55 holders each); they are not in the headline wallet counts.

---

## §4 Feasibility spike

### Proven

1. **Mint decoding matches the issuer.** SPYx, KOx and NVDAx are Token-2022, 8 decimals, with a 56-byte `ScaledUiAmountConfig` `{authority, multiplier f64, newMultiplierEffectiveTimestamp i64, newMultiplier f64}`. Once the timestamp passes, `newMultiplier` is active and `multiplier` still holds the *previous* value. That matched `/multiplier` on all three. **The active multiplier must be derived from cluster time; reading `multiplier` alone is wrong after every activation.**
2. **Corporate-actions API is live and its schema is verified.** `/public/corporate-actions/history` (694 rows) and `/upcoming` (539). Records include typed `caType`, `status` (665 Initial, 16 Corrected, 13 Cancelled), a `version` up to 8, exact decimal `multiplierOld/New`, per-share `grossCashflowUsd`/`netCashflowUsd`, and `withholdingTaxRate` (0.3 on US names).
3. **Classification by evidence works on real data.** Running `classifyTransition` over all 654 recorded transitions:

   | Outcome | Count |
   |---|---|
   | Confirmed dividend | 628 of 641 dividend-labelled |
   | Split reconciled (NFLXx 10:1, VUGx 6:1, KLACx 10:1 on a dividend-carrying multiplier, …) | 8 of 8 |
   | Reverse split reconciled (HONx 1:2) | 1 |
   | Unclassified: SpinOff 6, StockMerger 1, StockDividend 1, UnitSplit not reconciling 1 | 9 |
   | Unclassified: no issuer action published for the change | 8 |

4. **USD income can come from issuer evidence.** Value = shares held × `netCashflowUsd`. SPYx 2026-06-18 implies a reinvestment price of ~$741, consistent with market. The issuer's `/price-data` is *latest only*; there is no event-time price endpoint.
5. **Price units.** `/price-data` quotes per **displayed** unit. NFLXx (M = 10) was $77.30 against $77.36 on Jupiter; SPYx and TQQQx agree too.

### Traps found - each now handled in code

| Trap | Evidence | Handling |
|---|---|---|
| Multiplier-history `reason` is not evidence | 5 non-cash-dividend actions labelled `Dividend`: spin-offs on GMEx, HONx (2025-10-30), DFDVx and OPENx, plus a SCCOx stock dividend. AZNx merger labelled `ReverseSplit`. No cash dividend is labelled otherwise. | Classify from corporate actions only ([ADR-0001](../adr/0001-classify-from-corporate-actions.md)) |
| "Any increase is income" is worse | 16 increases are not cash dividends: 9 forward splits (up to +900%), 5 spin-offs, 1 stock dividend, 1 unit split. Includes HONx 0.512 → 0.999 (+95%, $216.66/share), which `reason` correctly labels `Administrative`. | No income policy for SpinOff / merger / stock dividend → unclassified |
| Multiplier changes with no corporate action | 8 dividend-labelled changes: STRCx ×2, SATAx, TQQQx, CMCSAx, LINx, NVOx, JPMx | Unclassified; open question to issuer |
| Issuer endpoints disagree in the last bit | HONx 2026-05-15: `1.020191445467247` vs `"1.0201914454672472"` | Match within 4ε relative; chain f64 is canonical |
| Issuer decimal strings exceed f64 precision | 59 rows | Never compare strings; lift chain f64 exactly |
| Issuer cash that does not match shares delivered | STRCx 2025-11-30 implies $953,728/share | Cross-check implied price against market (±20%), else market value with warning |
| Missing issuer cash | 16 dividends with null `netCashflowUsd` | USD `null`, counted as unvalued; never zero |
| Documented activation time is not the real one | Docs say 00:30 UTC; observed 23:55, 04:00, 11:20, 13:00, 21:48 | Schedule from the on-chain timestamp only |
| Price sources disagree | CRWDx: xStocks $206.37 vs Jupiter $119.41 (-42%) | Open - needs a staleness/disagreement rule before any valuation ships |

### Not yet proven

- **Chain-side transition history.** Nothing has yet recovered the `UpdateMultiplier` transactions (write slot vs activation) or balance history for closed accounts. Public RPC cannot do it at useful depth, so an **archival provider must be chosen**. Until then, issuer multiplier history stands in for chain observations in tests.
- **Event-time prices.** None of the available sources provides one. Needed for the fallback valuation and for yield metrics.
- **Product policy for non-dividend distributions.** Spin-offs, stock dividends and mergers are real economic events. Today they are shown as "classification pending" and are not income. That is honest, but it is not a final answer.

---

## 0.2 Regulatory boundary

Not started. It needs a written read from securities counsel. xStocks are not available to US persons, and eligibility must not be inferred from a wallet connection.

If the product becomes an accounting API rather than a consumer app, the questions change. They are drafted in [counsel-questions-api.md](counsel-questions-api.md). One is already partly answered from public documents: the issuer publishes **no licence for commercial use of its API data**, and its website terms prohibit commercial use and automated retrieval of site content. Written terms from Backed are needed before productizing.

## Built so far (program-free, no app yet)

- `packages/domain` - exact `Rational` over BigInt (with exact f64 lift), unit helpers, and a branded scaled price type.
- `packages/issuers` - Zod-validated xStocks adapter. Every row is validated on its own, with rejections kept. Fetch failures are reported separately from "no data".
- `packages/accounting` - evidence classifier and a pure protected-floor ledger (PLAN §6), with worked-example and property tests.
- `fixtures/xstocks` - recorded issuer data for nine tickers covering dividends, splits, a reverse split, a spin-off and corrections.
