# Corpact demo — run 2026-09-14T20-00-03-001Z

> **Part 1 and Part 3 are SYNTHETIC.** They use a local surfpool network with no mainnet connection, keys generated for this run, and issuer records written by the demo. The database is permanently labelled synthetic, and every API response and export says so.
>
> **Part 2 is RECORDED issuer data**, replayed offline. There were no live calls to the issuer.

## Part 1 — Walkthrough (SYNTHETIC: local network, generated keys and issuer records)


### Step 1 — A holder with a synthetic position

|  |  |
|---|---|
| Raw base units on chain | 10000000000 |
| Multiplier | 1 |
| Displayed quantity (raw ÷ 10^8 × multiplier) | 100.00000000 |
| Protected floor (stock units) | 100.00000000 |
| Available to convert | 0.00000000 |
| Coverage | complete, reconciled to the chain balance: true |

The issuer has scheduled a cash dividend for 2026-09-14T20:01:31.000Z (multiplier 1 → 1.0035) and published its record: $0.50 gross, 30% withholding, $0.35 net per share.

### Step 2 — The dividend activates with no transaction

|  | Before | After activation |
|---|---|---|
| Raw base units on chain | 10000000000 | 10000000000 |
| Transactions that ever touched the holder's token account | 1 | 1 |
| Displayed quantity | 100.00000000 | 100.35000000 |

At 2026-09-14T20:01:31.000Z the multiplier became 1.0035 by chain time alone. No transfer, no account write: an indexer following transfers sees nothing. Corpact detected it from the mint's scheduled multiplier and the cluster clock.

### Step 3 — The verified dividend entry

|  |  |
|---|---|
| Classification | Verified dividend: issuer CashDividend 9c8ffa2a, matched on exact multipliers and activation time |
| Extra quantity | 0.35000000 |
| Estimated event value | $35.00, from issuer-reported net cash ($0.35 × 100 shares held); not a market price |
| Form | Retained in stock: the value arrived as extra shares, not cash. USDC received: $0.00 |
| Protected floor / available to convert | 100.00000000 / 0.35000000 |

> Your DWLKx position gained 0.35000000 stock-equivalent units from a verified dividend adjustment. Value from issuer-reported net cash reinvested: $35.00. This remains invested in the stock.

### Step 4 — A 2-for-1 split is not income

|  | Before split | After split |
|---|---|---|
| Displayed quantity | 100.35000000 | 200.70000000 |
| Protected floor | 100.00000000 | 200.00000000 |
| Dividend income | $35.00 | $35.00 |
| Entry booked by the split | — | split ×2, USD none |

The quantity basis doubles and the floor moves with it. Income stays exactly where it was: a naive "units went up" reading would book the split as a 100% gain.

### Step 5 — The issuer corrects the dividend

The issuer publishes revision 2 of the dividend: withholding 34% instead of 30%, net $0.33 per share.

| Journal row | Entry | Kind | USD | Issuer revision | Reason |
|---|---|---|---|---|---|
| #1 | recognition | dividend | $35.00 | 1 | initial |
| #2 | recognition | split | — | 1 | initial |
| #3 | reversal of #1 | dividend | $35.00 | 1 | issuer_correction |
| #4 | recognition | dividend | $33.00 | 2 | issuer_correction |

The original recognition (#1, $35.00) is still there. It is reversed by #3 and replaced by #4 at $33.00. Nothing was edited or deleted. The income entry now shows $33.00 as revision 2.

Conversion for this position: Conversion is not enabled in this release; The issuer corrected a past action on 2026-09-14; review the revised income before converting.

## Part 2 — Six real cases the naive reading gets wrong (RECORDED issuer data)

> **Recorded, not synthetic, and not live.** These are xStocks corporate-action and multiplier-history responses recorded on 2026-09-13 (`fixtures/xstocks/recorded-20260913`), replayed offline through the production classifier.

### HONx spin-off: a +95% multiplier change that is not income

|  | Naive reading | Corpact |
|---|---|---|
| Rule | Any multiplier increase is a dividend | Classify from issuer corporate-action evidence, never from the size or label of the change |
| Result | **Books 95.11% more shares as dividend income, worth the issuer's $216.66 per share held** | **Spin-off — basis allocation, no income booked.** Books the 95.11% unit change as principal bought with the distributed value (48.75% of the position); nothing is added to income or made available to convert |

Evidence: multiplier 0.5120473566533945 → 0.9990655067370947 at 2026-06-29T23:55:00.000Z; multiplier-history label "Administrative"; issuer record SpinOff (ca3da1bc), issuer cash figure $216.6649884 per share.

Stated reason: _Issuer SpinOff ca3da1bc; distributed share (M_new − M_old) ÷ M_new = 0.48747, from the multipliers alone_

### STRCx implausible issuer cash: $0.63 per share for 0.00000066 shares

|  | Naive reading | Corpact |
|---|---|---|
| Rule | Value a dividend at the issuer's net cash | Classify from issuer corporate-action evidence, never from the size or label of the change |
| Result | **Books $0.62708331 of income per share held, though only 0.00000066 shares were delivered per share** | **Dividend recognized — USD unknown.** Keeps the delivered quantity as a verified dividend and counts it as unvalued; USD is null, never zero |

Evidence: multiplier 1 → 1.000000657507339 at 2025-11-30T23:55:00.000Z; multiplier-history label "Dividend"; issuer record CashDividend (3c56a5bc), net cash $0.62708331 per share.

Stated reason: _Issuer net cash implies reinvestment at $953728.23/share against a median of $94.80 across 9 other STRCx dividends; issuer valuation not used_

The issuer's own numbers imply a reinvestment price of **$953,728.23** per share (M_old × net cash ÷ (M_new − M_old)), against a median of **$94.80** across STRCx's other dividends.

### KRAQx rights sale labelled "UnitSplit": 1.38% that is neither a split nor income

|  | Naive reading | Corpact |
|---|---|---|
| Rule | Trust the issuer's action type | Classify from issuer corporate-action evidence, never from the size or label of the change |
| Result | **Books a 1:1 unit split, which cannot explain a 1.38% change: either rejects it, or rescales units with no basis allocated** | **Rights distribution — basis allocation, no income booked.** Books 1.36% of the position's value as principal from rights sold and reinvested; nothing is added to income or made available to convert |

Evidence: multiplier 1 → 1.01375909737 at 2026-03-26T23:55:00.000Z; multiplier-history label "Administrative"; issuer record UnitSplit (25ca1d3c v3, note "Selling proceeds of 18,606 warrants @ $0.5553321509 - $100 (subscription fee)").

Stated reason: _Issuer labelled this UnitSplit, but a 1:1 unit ratio cannot change the multiplier; its note reports rights (warrants) sold and the proceeds reinvested_

### SCCOx stock dividend with six issuer versions, the last one "Cancelled"

|  | Naive reading | Corpact |
|---|---|---|
| Rule | Take the latest issuer version | Classify from issuer corporate-action evidence, never from the size or label of the change |
| Result | **v6 is Cancelled, so the stock dividend reads as cancelled and the 1.53% change goes unexplained, or is booked as income by size** | **Stock dividend — quantity and basis adjustment, no income booked.** Units ×1.015318 on the delivered record (v5), cost basis spread across them; v6 cancels only the v4 schedule, and the lifecycle keeps all six revisions |

Evidence: multiplier 1.003847883664 → 1.019224471246712 at 2026-08-12T00:30:00.000Z; multiplier-history label "Dividend"; issuer record StockDividend (ed857d4c v5).

Stated reason: _Stock dividend factor derived from multipliers; the delivered issuer record publishes no unit ratio; Issuer version 3 (Cancelled) stated 1:1.012; the delivered change is ×1.015318; booked on the delivered evidence; Issuer version 2 (Cancelled) stated 1:1.012; the delivered change is ×1.015318; booked on the delivered evidence; Issuer version 1 (Scheduled) stated 1:1.012; the delivered change is ×1.015318; booked on the delivered evidence_

### LINx withholding refund arriving as a new dividend

|  | Naive reading | Corpact |
|---|---|---|
| Rule | Take the latest issuer version, and book cash with a multiplier increase as a dividend | Classify from issuer corporate-action evidence, never from the size or label of the change |
| Result | **The Corrected v3 replaces v2: the 2026-03-11 dividend loses its evidence, and $0.48 per share books as a new dividend** | **Withholding refund — income, distinguishable from a new dividend.** Keeps 2026-03-11 as a cash dividend of $1.12 net and books $0.48 as a withholding_adjustment: 1.12 + 0.48 = 1.6 gross, withholding deducted once |

Evidence: multiplier 1.0075564310790033 → 1.0085324892979617 at 2026-03-26T23:55:00.000Z; multiplier-history label "Dividend"; issuer record CashDividend (5cedd8fc v3, note "WHT wrongly applied for a foreign company. On March, 26 was received $1.6 on the 521 shares held at ex-date. We are creating this event in order to pass the $0.48 (wht tax) deducted").

Stated reason: _Withholding refund: passes back tax withheld on an earlier distribution; not a new dividend. Issuer note: WHT wrongly applied for a foreign company. On March, 26 was received $1.6 on the 521 shares held at ex-date. We are creating this event in order to pass the $0.48 (wht tax) deducted_

### AZNx ADR conversion labelled "ReverseSplit"

|  | Naive reading | Corpact |
|---|---|---|
| Rule | Trust the multiplier-history label | Classify from issuer corporate-action evidence, never from the size or label of the change |
| Result | **Books a 2:1 reverse split: the units are right, but the position silently becomes a different listing, with no lineage from the ADR it was** | **Identity change — basis carried over, lineage recorded, no income booked.** NASDAQ:AZN (ADR) → NYSE:AZN, units ×0.5; all cost basis moves to the new identity, and the worker writes the lineage link |

Evidence: multiplier 1.003871122822 → 0.501935561411 at 2026-02-02T22:00:00.000Z; multiplier-history label "ReverseSplit"; issuer record StockMerger (c8815421 v1, note "Stock Merger 0.5 NYSE:AZN for 1 NASDAQ:AZN (ADR)").

Stated reason: _Issuer labelled this StockMerger; its note exchanges 1 NASDAQ:AZN (ADR) for 0.5 NYSE:AZN of the same company: an identity change of the underlying, not a merger_


## Part 3 — Trap regression suite (SYNTHETIC), and every check in this run

Part 3 runs every Phase 0 trap the ledger can reproduce without a price source through the full chain → worker → API path, then checks what happens when an independent RPC provider disagrees.

**59 of 59 checks passed** across all three parts, all read back through the API.

**walkthrough**

- ✅ Step 1: the position is complete and reconciled, with raw units, displayed quantity and floor
- ✅ Step 2: the dividend arrives with no token transfer
- ✅ Step 3: a verified dividend worth $35 from issuer net cash, retained in stock
- ✅ Step 4: the split doubles the quantity basis and books zero income
- ✅ Step 5: the correction appends a reversal and a replacement; the original row survives

**recorded issuer data**

- ✅ HONx spin-off books a basis allocation, no income; the naive reading books +95%
- ✅ STRCx keeps the dividend but refuses the $953k/share valuation
- ✅ KRAQx rights sale labelled UnitSplit books a basis allocation, not a split or income
- ✅ SCCOx resolves on the delivered record through six revisions, reporting the superseded 1:1.012
- ✅ LINx withholding refund is not a new dividend, and withholding is deducted once
- ✅ AZNx ADR conversion is an identity change, not the reverse split its label says

**suite: first sync**

- ✅ DDIVx D1 cash dividend (later corrected)
- ✅ DDIVx D2 cash dividend after a deposit
- ✅ DDIVx D3 implausible issuer cash
- ✅ DDIVx D4 no issuer cash
- ✅ DDIVx S1 2-for-1 forward split after a withdrawal
- ✅ DDIVx SP spin-off labelled "Dividend"
- ✅ DDIVx N1 change with no corporate action
- ✅ DDIVx D5 dividend whose issuer decimal differs in the last bit
- ✅ DDIVx D6 dividend published 20 s after its schedule
- ✅ DDIVx D7 dividend whose issuer record arrives late
- ✅ DPARx P1 dividend on a position held before the first observed multiplier write
- ✅ DDIVx X is recorded as superseded and never booked
- ✅ DDIVx D6 applies at publication and leaves no history gap
- ✅ DDIVx replays deposit, withdrawal and split to the exact chain balance
- ✅ DDIVx income is exactly the valued dividends: the split, spin-off and unmatched change add nothing
- ✅ DDIVx counts dividends without a trustworthy value instead of zeroing them
- ✅ DPARx is partial: it was held before its multiplier history is observable
- ✅ DPARx claims no yield; DDIVx claims yield over its fully covered tracked period
- ✅ DDIVx SP through API v2: a validated spin-off booked as a basis allocation, activated, with no income
- ✅ Every v2 action states its validation status and lifecycle, and v2 lists exactly the v1 entries
- ✅ The independent provider agrees on every balance
- ✅ The first sync only recognizes; nothing is reversed

**suite: late record + correction**

- ✅ DDIVx D1 cash dividend (later corrected)
- ✅ DDIVx D2 cash dividend after a deposit
- ✅ DDIVx D3 implausible issuer cash
- ✅ DDIVx D4 no issuer cash
- ✅ DDIVx S1 2-for-1 forward split after a withdrawal
- ✅ DDIVx SP spin-off labelled "Dividend"
- ✅ DDIVx N1 change with no corporate action
- ✅ DDIVx D5 dividend whose issuer decimal differs in the last bit
- ✅ DDIVx D6 dividend published 20 s after its schedule
- ✅ DDIVx D7 dividend whose issuer record arrives late
- ✅ DPARx P1 dividend on a position held before the first observed multiplier write
- ✅ DDIVx D1 shows the corrected value as revision 2, with the correction time
- ✅ The correction is journaled as a reversal plus a replacement
- ✅ Every earlier journal row is still present and unchanged
- ✅ DDIVx D7 is recognized once its issuer record arrives
- ✅ Conversion is paused for review after the correction
- ✅ The journal CSV carries every journal row, each labelled synthetic

**suite: deterministic replay**

- ✅ Re-running the sync appends no journal rows
- ✅ Re-running the sync reproduces every income entry exactly
- ✅ Re-running the sync reproduces every position exactly

**suite: independent provider disagrees**

- ✅ A second provider reporting a different balance is recorded as a disagreement
- ✅ Conversion is paused for the affected position only
- ✅ Reads stay available and the ledger is untouched
- ✅ Monitoring reports the disagreement as critical

**suite: providers agree again**

- ✅ Once the providers agree again, the pause lifts
- ✅ Monitoring no longer reports a disagreement

