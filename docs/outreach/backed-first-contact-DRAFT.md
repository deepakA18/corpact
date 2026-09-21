# DRAFT - first contact with Backed Finance (xStocks)

> **Not sent. Not for sending as-is.**
> - Get a second human read on tone before sending.
> - Hold until counsel answers [question 7](../findings/counsel-questions-api.md): whether findings from automated retrieval can be cited.
> - Re-check every example against the live API on the day of sending. These are from a 2026-09-13 recording.
> - Deliberately left out: integrator-side mistakes that are not issuer errors (HONx 2026-06-29 is correctly labelled `Administrative`), the unresolved CRWDx price gap, and any wallet-level analysis.

---

**Subject:** Reconciling xStocks corporate actions with Solana multiplier changes - a few questions

Hi [name],

I'm [name], and I'm working on accounting tooling for tokenized equities on Solana. To show xStocks holders their dividend income correctly, we reconciled your public corporate-actions feed against every Scaled UI multiplier change on Solana over the past year: 654 changes across your Solana deployments.

Most of it reconciles cleanly. 628 of the 641 dividend-labelled changes match a `CashDividend` record exactly, and every forward split reconciles to its unit ratio. A few cases we couldn't reconcile, and we'd rather ask than guess:

1. **`reason` versus `caType`.** Five changes labelled `Dividend` in `/multiplier/history` match non-cash-dividend corporate actions: spin-offs on GMEx (2025-10-08), HONx (2025-10-30), DFDVx (2025-11-07) and OPENx (2025-11-24), and a stock dividend on SCCOx (2026-08-12). An integrator reading `reason` would report these as dividend income. Is `caType` the field you intend integrators to rely on?

2. **Changes without a corporate-action record.** Eight dividend-labelled multiplier changes have no matching entry in `/corporate-actions/history`. Examples: STRCx on 2026-04-01 and 2026-05-15, JPMx on 2026-04-03, TQQQx on 2026-03-25. Are they published somewhere else, or due to be backfilled?

3. **Cash versus multiplier.** The STRCx record effective 2025-11-30 lists $0.627 net per share, while the multiplier moved from 1 to 1.000000657. We may be missing context, such as a pro-rated first period. How should the two be reconciled?

4. **Precision.** A few multipliers differ in the last representable digit between `/multiplier/history` and `/corporate-actions/history` (e.g. HONx, 2026-05-15). Should the on-chain value be treated as canonical?

We're happy to share the full reconciliation if it's useful to your team.

[Optional - include here, or hold for a second message once there is a dialogue:]
We'd also like to build on the corporate-actions feed in a product for exchanges and protocols that integrate xStocks. Your site terms limit commercial and automated use, and we couldn't find terms specific to the API. Is there an API or data agreement we should be working under?

Best,
[name]
