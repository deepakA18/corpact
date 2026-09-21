# Questions for securities counsel - accounting API posture

**Status:** draft brief, not legal analysis · **Date:** 2026-09-13 · **Gate:** PLAN §0.2, now the gating check

## What we would offer

The service is read-only accounting infrastructure for tokenized equities on Solana (xStocks today). Business customers - exchanges listing xStocks, lending protocols accepting them as collateral, portfolio trackers and tax tools - send a position or a wallet. They receive back:

1. **Event classification.** Each on-chain balance-multiplier change is labelled dividend, split, spin-off or unclassified, with the issuer record it was matched to and the reasons.
2. **Dividend-attributed quantity**, with a USD estimate and the valuation source named.
3. **Principal versus dividend-attributed exposure** per position (the "protected floor").

We would not custody assets, execute trades, route orders, hold customer or end-user funds, or recommend any action. Inputs are public blockchain data and the issuer's public API.

## Questions

1. **Regulated activity.** In [target jurisdiction(s) - to be fixed], is supplying corporate-action classification and income calculations for third-party tokenized securities to businesses a regulated activity? Candidates we can see: market-data vendor, investment advice, benchmark or index administration.
2. **Where the line sits.** Does it change the answer if the output includes an "available to convert" figure that a customer might use to drive sales? Should the API stop at classification and attributed quantity?
3. **Tax characterisation.** Can we label amounts "income", or does that amount to tax advice? The issuer reinvests dividends net of withholding and pays no cash. Would "dividend-attributed exposure" be the safer term?
4. **Liability for error.** If a customer relies on our output and misstates a user's income or collateral value, what disclaimers, terms and service levels are appropriate? Our own validation shows the issuer's data itself is sometimes inconsistent.
5. **Issuer data rights.** May we build a commercial service on derived xStocks corporate-action and multiplier data? *Read on 2026-09-13; no published grant found:*
   - **No API-specific terms or license were found.** The API docs describe public endpoints for "exchanges, protocols, and developers" but attach no license. `docs.xstocks.fi/legal/terms` is a joke page.
   - **The website terms are restrictive** ([xstocks.fi terms PDF](https://xstocks.fi/documents/xstocks-terms-of-service.pdf); backed.fi terms match; Backed Finance AG, Swiss law, courts of Zug). They cover the "Site" and "Services", meaning informational material about xStocks. Use is granted "for informational purposes". §3 prohibits use "in connection with any commercial endeavors" and any "automatic device or process to retrieve, index, data-mine, or in any way reproduce" content. §6 prohibits republishing.
   - **Open:** whether those terms reach the API at all. Read literally, "Services" does not name it, but nothing grants commercial rights either. **Recommended before productizing:** ask Backed for written API terms or a data agreement. That conversation doubles as customer discovery, since Backed and its distributors are among the likeliest buyers.
6. **Downstream eligibility.** xStocks are not available to US persons. Do we inherit any obligation if a customer serves users the issuer excludes?
7. **Exposure from the validation work itself.** Before any commercial product or agreement, we ran scripts against the public xStocks API on 2026-09-13. Approximate traffic: 10 asset-list pages, 835 multiplier-history requests, 17 corporate-action pages, ~700 price requests, ~15 documentation pages. Does this pre-commercial research retrieval create exposure under §3(4)'s prohibition on automated retrieval? Should it pause until written terms exist? Can we cite the resulting findings in an approach to the issuer?
8. **Wallet-level data.** Our demand analysis profiles public wallet addresses by holdings and activity. Is a wallet address personal data in the target jurisdiction? What limits apply to storing and publishing such profiles? (Our current practice: committed evidence is aggregate only; address-level output stays local.)

## Not in scope of this engagement

Custody, a program-controlled vault, automated conversion and anything else in PLAN Appendix A. If that is ever pursued, it needs its own engagement.
