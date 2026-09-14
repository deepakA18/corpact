# Corporate-actions census: what actually happens to tokenized stocks

**Investigated:** 2026-09-14.

**Sources:**
- Recorded issuer data, `fixtures/xstocks/recorded-20260913`: 694 historical rows (661 events) and 539 upcoming rows (525 events). Read offline, with no calls to the issuer.
- A read-only on-chain census of all 832 recorded Solana mints.
- A full scan of the permanent delegate's transaction history.
- Aggregates: [evidence/authority-census-20260914.json](evidence/authority-census-20260914.json).

Counts use the latest version of each issuer event.

## 1. Action types that occur

| `caType` | Historical | Upcoming (latest) | Notes |
|---|---|---|---|
| CashDividend | 642 | 515 (5 cancelled) | Includes withholding refunds and retention adjustments (§4) |
| ForwardSplit | 9 | 7 | |
| SpinOff | 6 | 1 | All delivered as cash reinvested through the parent (§2) |
| ReverseSplit | 1 | 1 | HONx 2:1 |
| StockDividend | 1 | 1 | SCCOx; its type was cancelled twice before delivery |
| UnitSplit | 1 | — | KRAQx: really a rights (warrant) sale |
| StockMerger | 1 | — | AZNx: really an ADR-to-ordinary conversion |
| CashMerger, StockAndCashMerger, Redemption, NameChange, WorthlessRemoval, RightsDistribution, CashAndStockDividend, Unknown | **0** | **0** | Defined in the issuer enum, never used |

- **Other fields.** No record uses `redemptionPriceUsd`. 24 historical records carry `notes`; those notes are the only evidence of several traps below.
- **Multiplier-history labels.** The reason field uses just four values: Dividend 641, Split 8, Administrative 3, ReverseSplit 2.

## 2. How spin-offs are delivered

xStocks do not create a token for the spun-off company. **The issuer sells the distributed shares and reinvests the proceeds into the parent through a multiplier increase.**

| Asset | Activation | Label | Multiplier | Increase | Share of value distributed (ΔM ÷ M_new) | Issuer cash | Delivery evidence |
|---|---|---|---|---|---|---|---|
| HONx | 2026-06-29 | Administrative | 0.51205 → 0.99907 | +95.11% | 48.75% | $216.66/share | Cash figure; implies a parent price of $227.80 against $233.99 from HONx's own dividends (reconciles within 3%) |
| CMCSAx | 2026-01-07 | Administrative | 1.01384 → 1.06167 | +4.72% | 4.51% | — | Note: "Sell of 373.48 shares of VSNT (CMCSA spin off) @ $34.56" |
| OPENx | 2025-11-24 | **Dividend** | 1 → 1.02082 | +2.08% | 2.04% | — | Multiplier only |
| DFDVx | 2025-11-07 | **Dividend** | 1 → 1.01473 | +1.47% | 1.45% | — | Multiplier only |
| HONx | 2025-10-30 | **Dividend** | 1.00166 → 1.01269 | +1.10% | 1.09% | — | Multiplier only |
| GMEx | 2025-10-08 | **Dividend** | 1 → 1.00531 | +0.53% | 0.53% | — | Multiplier only |

**What this means for detection.** A spin-off is a multiplier transition on the parent mint, like a dividend, so the existing observation path detects it. Only the issuer's `caType` distinguishes it.

**What this means for basis.** The holder ends with more parent units, bought with the spun-off company's value. The fraction of the position's economic value that came from the distribution is exactly `(M_new − M_old) ÷ M_new`. The issuer reinvested at market, so **no price source is needed** to compute that allocation factor.

The engine reports the factor and its evidence. Whether a jurisdiction treats the cash-reinvested distribution as a tax-free spin-off, a sale or income is the buyer's question, not the engine's.

## 3. Other basis events

**HONx reverse split (2026-06-29 15:30).** From 2 units to 1: multiplier 1.02409 → 0.51205. It reconciles exactly. Tokens are fractional, so no fractional remainder is cashed out at the wrapper level. **Fractional cash-in-lieu has 0 instances.**

**SCCOx stock dividend (2026-08-12).** The multiplier goes from 1.00385 to 1.01922 (+1.53%), labelled "Dividend". The upcoming feed shows the type churning:
- scheduled as a `StockDividend` of 1 → 1.012;
- cancelled with the note "Will be a cash flow, not a unit change";
- cancelled again;
- rescheduled, and finally delivered as a unit change.

The evidence changed character twice before settling.

**KRAQx "UnitSplit" (2026-03-26).** Units 1 → 1, but the multiplier moved +1.38%, over 3 versions ending `Corrected`. The note reads "Selling proceeds of 18,606 warrants @ $0.5553321509 − $100 (subscription fee)". This is a **rights (warrants) distribution, sold and reinvested**, labelled as a unit split. The classifier books it as a rights distribution (basis allocation) on the evidence of the note. Without the note it stays unclassified, because the 1:1 unit ratio does not reconcile with the multiplier change.

**AZNx "StockMerger" (2026-02-02).** Units 2 → 1: multiplier 1.00387 → 0.50194, labelled "ReverseSplit" in multiplier history. The note reads "Stock Merger 0.5 NYSE:AZN for 1 NASDAQ:AZN (ADR)". This is an **ADR-to-ordinary-share conversion**: the underlying instrument changes identity, and units halve. Economically it is neither a merger with a different company nor a plain reverse split. It is the one real case for position lineage across an underlying change.

## 4. Dividend-adjacent traps

- **Size is not evidence.** The median dividend raises the multiplier by 0.238%; the largest (WHGROx) by 2.93%; none exceeds 5%. Four of the six spin-offs (+0.53%, +1.10%, +1.47%, +2.08%) sit **inside** that range. A size threshold would book them as dividends. No record is labelled special or extraordinary.
- **Withholding refunds arrive as new "dividends".**
  - LINx 2026-03-26: "WHT wrongly applied for a foreign company … creating this event in order to pass the $0.48 (wht tax) deducted".
  - NVOx 2025-09-05: "incorrectly charged 30% WHT … adjust multiplier again".

  These are refunds of tax withheld on an earlier distribution, not new income events.
- **Retention.**
  - LINx, ETNx and ASMLx: "5% retention to cover currency fluctuations", so net cash is below gross × (1 − withholding).
  - TSMx 2026-06-11: "Was added $3.08 … from previous corporate action retention", which is an earlier retention paid out.
- **Payable-date processing.** Several dividends are "processed at the payable date" rather than the ex-date. The activation time says when the holder's exposure changed, not when the holder became entitled.
- **Cancelled actions.** 5 upcoming dividends were cancelled ("Incorrect amount", "Entered incorrectly", "Corporate action removed by provider", "Don't have this collateral in the portfolio").

## 5. Authority census and seizure

Every one of the 832 recorded mints is Token-2022 with the same extensions: ScaledUiAmount, PermanentDelegate, Pausable, DefaultAccountState (initialized), TransferHook, ConfidentialTransferMint, MetadataPointer and TokenMetadata.

| Authority | Key | Mints |
|---|---|---|
| Permanent delegate | `5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq` | 832 |
| Freeze and pausable authority | `JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs` | 832 (none currently paused) |
| Mint authority | `7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj` | 832 |

The issuer can move any holder's tokens (permanent delegate), freeze or pause any mint, and mint at will.

**Seizure scan.** Every successful transaction in the permanent delegate's history was read: 1,685 transactions, 2025-06-10 to 2026-09-03, none truncated. Transfer and burn instructions whose authority is the delegate and whose source account belongs to someone else: **0**. The history is mint deployments (1,327 initializations and authority changes), 4 mints, and 2 transfers not out of third-party accounts.

**On xStocks, as of this date, no seizure by the permanent delegate has occurred on chain.** A seizure classifier would have nothing to validate against.

**Halted assets.** Four assets (CKAHx, CKHUTx, CITICx, JPSTx) are marked `isTradingHalted` and have no termination, redemption or delisting record. Their mints are not paused.

## 6. End-to-end check of the AZNx identity change on a real wallet (2026-09-14)

**Method.** A real mainnet wallet was chosen from chain reads only (`getProgramAccounts` on the AZNx mint): its AZNx token account was active from 2025-09-18, before the conversion. It was synced by the unmodified worker, with issuer data from recorded fixtures, then read back through the running API. The address and per-wallet output stay local; only aggregates are recorded here.

**Classification and lineage.**
- The conversion was classified `identity_change`, `validated`, classifier `classify-v4`, from `NASDAQ:AZN (ADR)` to `NYSE:AZN`.
- The worker wrote the first rows of the position lineage:
  - 2 `instrument_identities` rows. The ADR is evidenced from the mint's first recorded multiplier change, 2025-09-08; the ordinary share is valid from 2026-02-02 22:00.
  - 1 `lineage_links` row with cash basis 0/1.
  - 1 `lineage_successors` row: basis 1/1, quantity factor 1/2.

**Downstream reads.**

| Read | Result |
|---|---|
| Ledger | Replay complete, and reconciled to the chain balance. The identity-change entry removes exactly half the displayed units and books no USD. The next AZNx dividend (2026-03-23) is valued from issuer net cash on the halved position. The journal holds one recognition per entry |
| `GET /v2/actions/{id}` | `type: identity_change`, `treatment: identity`, lifecycle `confirmed` (2026-02-02 21:53:48, the publication block time) → `activated` (22:00:00). There is no `announced` step, correctly: the issuer record was created at 22:49, after activation. `evidenceSha256` matches the stored payload hash. The `lineage` block carries the link |
| `GET /v2/instruments/{mint}/lineage` | Traced basis ends at `NYSE:AZN` with fraction exactly 1, not terminated |
| `GET /v1/income` | The same entry is `unclassified_adjustment`, `splitFactor` null, USD null, with the reason "Identity change of the underlying booked as a quantity adjustment, not income: units ×0.500000". v1 semantics are unchanged |
| `verify-integrity` | Passed after the sync: journal structure, journal equals income, all evidence hashes, append-only guards on 9 tables |

**What is not claimed.** The position is `partial`, and the check does not hide it:
- the wallet's history exceeds the sync cap, so older token accounts may be missing;
- two other mints in this wallet have multiplier-timeline gaps.

Neither affects the AZNx identity-change path, which replayed completely. The same wallet also exercised six spin-offs and one withholding refund through API v2.
