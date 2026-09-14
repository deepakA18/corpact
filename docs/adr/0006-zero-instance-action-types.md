# ADR-0006: Zero-instance action types stay unvalidated, and seizure stays not built

Status: accepted, 2026-09-15

## Context

ADR-0005 orders the corporate-actions work by real occurrences. Several action types in the taxonomy have **no real instance** in the recorded issuer data (`fixtures/xstocks/recorded-20260913`) or in the permanent delegate's on-chain history. A classifier for such a type cannot be validated. A ledger treatment for one would be a guess about how the issuer delivers an action it has never delivered.

## Decision

Each zero-instance type gets the minimum needed for taxonomy completeness and API shape, and nothing more. No fixture is invented for any of them. Tests that exercise routing retype a real record and assert only that nothing is booked.

| Type | Taxonomy kind | Status | What is built | What is not |
|---|---|---|---|---|
| Cash merger | `cash_merger` | unvalidated | Recognised from the issuer type; unclassified adjustment; conversion disabled | Termination booking. How xStocks would deliver cash for a delisted underlying (multiplier to zero, burn, off-chain redemption) is unknown |
| Stock and cash merger | `mixed_merger` | unvalidated | Same | Transform lineage with a cash leg. The `transform` link kind exists and conserves basis in property tests, but nothing writes it |
| Stock-for-stock merger into another company | `stock_merger` | unvalidated | Recognised; an issuer note naming a *different* ticker is refused explicitly | The only `StockMerger` record (AZNx) is a listing conversion of the same company, classified as an identity change |
| Redemption or wrapper discontinuation | `redemption` | unvalidated | Recognised; unclassified | `terminate` lineage. 4 assets are marked halted, none terminated |
| Delisting or worthless removal | `delisting` | unvalidated | Recognised; unclassified | Same |
| Name or ticker change | `identity_change` via `NameChange` | unvalidated | A `NameChange` record matching a multiplier change is refused as unvalidated | Detection of a rename with no multiplier change. It would need registry diffs, not the multiplier timeline. The identity-change lineage path itself is validated on AZNx |
| Cash and stock dividend | `cash_and_stock_dividend` | unvalidated | Recognised; unclassified | Splitting one multiplier change into income and a stock dividend needs a price or an issuer unit ratio; neither has a real instance |
| Rights distribution labelled `RightsDistribution` | `rights_distribution` | unvalidated for this label | Recognised; unclassified | The validated rights path covers only rights *sold and reinvested*, evidenced by KRAQx (labelled `UnitSplit`). Exercised or lapsed rights: not built |
| Unit split | `unit_split` | unvalidated | A reconciling `UnitSplit` is refused as unvalidated | The only `UnitSplit` record (KRAQx) was a mislabelled rights sale |
| Fractional cash in lieu | `cash_in_lieu` | unvalidated | A split record publishing cash is refused as unvalidated | Scaled UI splits rescale the multiplier, so raw token amounts never become fractional. The path is structurally unlikely, not merely unobserved |
| Permanent-delegate transfer (seizure) | `seizure` | **not built** | Taxonomy entry only | Everything else. See below |

"Unvalidated" means one thing everywhere: in `ACTION_KIND_SPECS`, in `GET /v2/taxonomy`, on every v2 action's `validation.status`, and in the docs. The change is an unclassified adjustment with a stated reason, no income and conversion disabled. A type is never presented as supported.

## Why seizure is left not built rather than speculatively implemented

- **No instance.** One delegate key (`5aMNNLQJ…`) is the permanent delegate on all 832 xStocks mints. Its full history (1,685 transactions) contains no transfer or burn out of another owner's account. A classifier would have no real positive to validate against.
- **It is a different evidence path.** A seizure is not a multiplier change. Detecting one means attributing each token movement to its signing authority: the holder, or the delegate. `balance_movements` records balances before and after, not the authority. Building this means changing wallet-history ingestion, which is the most validated part of the system, for an event that has not happened.
- **Today's consequence, stated plainly.** A delegate transfer out of a tracked wallet would be booked as a **withdrawal**. The protected floor scales down proportionally, no income is affected, and the position still reconciles with the chain. It would **not** be flagged as a seizure. That is the known gap.
- **What would change the decision:** an instance on xStocks, or a buyer naming an issuer whose delegate has used the power. Then: record the transfer authority in `balance_movements`, add a delegate-activity monitor alongside the authority census, and validate against that issuer's instance.

## Consequences

- Taxonomy completeness holds: every issuer `caType` maps to a kind, and the tests enforce both rules. No zero-instance kind is `validated`, and every `not_built` kind is `not_booked`.
- A premise that a seizure has occurred on xStocks must not be reintroduced without a new census.
