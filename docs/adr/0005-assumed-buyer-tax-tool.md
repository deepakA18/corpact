# ADR-0005: Assume a tax tool as the buyer for the corporate-actions engine

Status: accepted, 2026-09-14

## Decision

The corporate-actions engine is built for a **tax and accounting tool**. Its needs come first: basis-affecting events (spin-offs, reverse splits, stock dividends, rights, mergers and identity changes, with their allocation factors) and an audit trail that never rewrites history. Display-only needs (exchange or wallet) and position-viability needs (lending) come later, and only where they overlap.

## Why

A tax tool has the hardest correctness requirements, and those requirements are where our moat is. Every basis-affecting action must be classified from issuer evidence and never from the size or label of a change. It must degrade to "unclassified" rather than guess, and it must stay reproducible after corrections. Most of what an exchange or lender needs (splits, identity changes, terminations) is a subset of that basis math. The recorded data also points this way: the actions that actually occur, beyond dividends and splits, are spin-offs, a stock dividend, a rights sale and an ADR conversion. All of them are basis events.

The engine produces **economic allocation factors and evidence, not tax treatment**. How a tracker certificate wrapping a US share is taxed in a given jurisdiction is a question for the buyer and for counsel.

## Real occurrences, and the resulting order

Counts are the latest version of each event in the recorded issuer data (`fixtures/xstocks/recorded-20260913`: 661 historical events, 525 upcoming) and a full scan of the permanent delegate's on-chain history. Detail is in [corporate-actions-census.md](../findings/corporate-actions-census.md).

| Order | Action | Real instances | Plan |
|---|---|---|---|
| 1 | Spin-off | **6** (GMEx, HONx ×2, DFDVx, OPENx, CMCSAx) | Build and validate. All are delivered as cash reinvested through the parent's multiplier; basis allocation = ΔM ÷ M_new |
| 2 | Reverse split | **1** (HONx 2:1) | Build and validate. Fractional cash-in-lieu: **0 instances**, so that path is labelled unvalidated |
| 3 | Stock dividend | **1** (SCCOx; the type changed twice before delivery) | Built and validated: a quantity-basis event resolved on the delivered record, with every superseded revision kept in the lifecycle |
| 4 | Rights | **1** (KRAQx: warrants sold, labelled `UnitSplit`) | Built and validated the sold-rights path as a basis allocation; exercised and lapsed: 0, unvalidated |
| 5 | Stock merger or underlying identity change | **1** (AZNx: ADR → ordinary 2:1, labelled `StockMerger` and "ReverseSplit") | Built and validated as an identity change; writes the first position-lineage rows |
| 6 | Special dividend | **0 labelled**; largest dividend +2.93%; 4 of 6 spin-offs fall inside the dividend size range | Routed through the dividend path; size-heuristic tests locked on real data for every basis event |
| 7 | Withholding refund delivered as a dividend | **2** (LINx 2026-03-26, NVOx 2025-09-05) | Built and validated: a distinct `withholding_adjustment` kind from the issuer note; the original dividend keeps its evidence; the 5% currency retention is recognised, not flagged |
| 8 | Cash or mixed merger | **0** | Recognised, labelled unvalidated, never booked ([ADR-0006](0006-zero-instance-action-types.md)) |
| 9 | Redemption, delisting, wrapper discontinuation | **0** (4 assets marked halted, none terminated) | Same ([ADR-0006](0006-zero-instance-action-types.md)) |
| 10 | Ticker or name change | **0** | Same; the identity-change lineage path is validated on AZNx ([ADR-0006](0006-zero-instance-action-types.md)) |
| 11 | Seizure (permanent-delegate transfer) | **0**. One delegate key on all 832 mints; its full history (1,685 transactions) contains no transfer or burn out of another owner's account | **Not built**, with the reasons and today's consequence in [ADR-0006](0006-zero-instance-action-types.md) |

## Consequences

- **Build order.** Task 1 (the action taxonomy with lifecycle, and position lineage) comes first, as the brief requires. Classifiers then follow the order above, not the brief's generic order: spin-offs lead because they are the most frequent basis event and the highest-value one.
- **Unvalidated classifiers.** An action type with no real instance ships only as an explicit **unvalidated** classifier: in code, in API metadata and in docs. It routes to an unclassified adjustment, with conversion disabled, whenever evidence is missing or conflicting.
- **Seizure.** The brief's premise that a live seizure occurred in this market is **not supported for xStocks** by on-chain history as of 2026-09-14. If it happened with another issuer, that issuer's data would be needed to validate a seizure classifier.
