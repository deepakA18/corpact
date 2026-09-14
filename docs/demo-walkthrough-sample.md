# Corpact demo — run 2026-09-14T14-34-14-848Z

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

The issuer has scheduled a cash dividend for 2026-09-14T14:35:43.000Z (multiplier 1 → 1.0035) and published its record: $0.50 gross, 30% withholding, $0.35 net per share.

### Step 2 — The dividend activates with no transaction

|  | Before | After activation |
|---|---|---|
| Raw base units on chain | 10000000000 | 10000000000 |
| Transactions that ever touched the holder's token account | 1 | 1 |
| Displayed quantity | 100.00000000 | 100.35000000 |

At 2026-09-14T14:35:43.000Z the multiplier became 1.0035 by chain time alone. No transfer, no account write: an indexer following transfers sees nothing. Corpact detected it from the mint's scheduled multiplier and the cluster clock.

### Step 3 — The verified dividend entry

|  |  |
|---|---|
| Classification | Verified dividend: issuer CashDividend d6bf5d6e, matched on exact multipliers and activation time |
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

## Part 2 — Two real cases the naive reading gets wrong (RECORDED issuer data)

> **Recorded, not synthetic, and not live.** These are xStocks corporate-action and multiplier-history responses recorded on 2026-09-13 (`fixtures/xstocks/recorded-20260913`), replayed offline through the production classifier.

### HONx spin-off: a +95% multiplier change that is not income

|  | Naive reading | Corpact |
|---|---|---|
| Rule | Any multiplier increase is a dividend | Classify from issuer corporate-action evidence, never from the size or label of the change |
| Result | **Books 95.11% more shares as dividend income, worth the issuer's $216.66 per share held** | **Unclassified adjustment — no income booked.** Shows the 95.11% unit change as pending classification; nothing is added to income or made available to convert |

Evidence: multiplier 0.5120473566533945 → 0.9990655067370947 at 2026-06-29T23:55:00.000Z; multiplier-history label "Administrative"; issuer record SpinOff (ca3da1bc), issuer cash figure $216.6649884 per share.

Stated reason: _Issuer action SpinOff (ca3da1bc-04d2-4c6a-a23e-51f7c58ee06d) has no income policy; not booked as income_

### STRCx implausible issuer cash: $0.63 per share for 0.00000066 shares

|  | Naive reading | Corpact |
|---|---|---|
| Rule | Value a dividend at the issuer's net cash | Classify from issuer corporate-action evidence, never from the size or label of the change |
| Result | **Books $0.62708331 of income per share held, though only 0.00000066 shares were delivered per share** | **Dividend recognized — USD unknown.** Keeps the delivered quantity as a verified dividend and counts it as unvalued; USD is null, never zero |

Evidence: multiplier 1 → 1.000000657507339 at 2025-11-30T23:55:00.000Z; multiplier-history label "Dividend"; issuer record CashDividend (3c56a5bc), net cash $0.62708331 per share.

Stated reason: _Issuer net cash implies reinvestment at $953728.23/share against a median of $94.80 across 9 other STRCx dividends; issuer valuation not used_

The issuer's own numbers imply a reinvestment price of **$953,728.23** per share (M_old × net cash ÷ (M_new − M_old)), against a median of **$94.80** across STRCx's other dividends.

## Part 3 — Trap regression suite (SYNTHETIC), and every check in this run

Part 3 runs every Phase 0 trap the ledger can reproduce without a price source through the full chain → worker → API path, then checks what happens when an independent RPC provider disagrees.

**53 of 53 checks passed** across all three parts, all read back through the API.

**walkthrough**

- ✅ Step 1: the position is complete and reconciled, with raw units, displayed quantity and floor
- ✅ Step 2: the dividend arrives with no token transfer
- ✅ Step 3: a verified dividend worth $35 from issuer net cash, retained in stock
- ✅ Step 4: the split doubles the quantity basis and books zero income
- ✅ Step 5: the correction appends a reversal and a replacement; the original row survives

**recorded issuer data**

- ✅ HONx spin-off books no income; the naive reading books +95%
- ✅ STRCx keeps the dividend but refuses the $953k/share valuation

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

