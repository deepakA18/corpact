# ADR-0003: Issuer corrections supersede interpretations and are journaled, never edited

**Status:** Accepted · **Date:** 2026-09-14 · **Plan:** §5.3, §6.5, §14

## Context

The issuer revises corporate actions after publishing them. The recorded xStocks history already holds 16 `Corrected` and 13 `Cancelled` records. STRCx event `c5721924` alone went through seven revisions, and only revision 8 matched what the chain did.

Before this decision, a multiplier change was classified once, and positions were rebuilt from scratch. A later revision was either ignored, because a match already existed, or it silently rewrote past income on the next rebuild. Nothing recorded that income had changed, when, or why. For an accounting product that is disqualifying: a customer's books cannot have yesterday's number quietly replaced.

## Decision

1. **Interpretations are superseded, not overwritten.** Classification re-evaluates every active transition against the current issuer records on each run. If the outcome differs from the stored match (kind, issuer event, revision, cash, split factor, reasons or warnings), the old match gets `superseded_at`/`superseded_by`, and the new one becomes current. An unchanged outcome writes nothing, so bumping the classifier version alone creates no churn.
2. **Recognized income lives in an append-only journal** (`ledger_journal`, protected by an append-only trigger). After each *complete* replay, the ledger's entries are compared with the open recognitions:
   - an unchanged entry writes nothing;
   - a changed entry appends a **reversal** of the old recognition plus a **replacement**;
   - an entry the replay no longer produces is reversed.
   Each change carries a reason: `issuer_correction`, `balance_history_changed`, `valuation_changed` or `no_longer_applicable`.
3. **Incomplete replays never touch the journal.** A transient RPC or history gap therefore cannot reverse income that was correctly recognized.
4. **Conversion pauses after a correction.** It is disabled for 7 days after an issuer correction changes a position's income, so the revised numbers are reviewed first (§5.3).
5. **The API exposes it.** Income entries carry `revision` and `correctedAt`. Event detail carries the full `history`. `GET /v1/journal` serves the audit trail that accounting and tax integrations need.

## Consequences

- Positions and `income_entries` remain a rebuildable *current view*; the journal is the durable record of what was reported and when.
- Late-arriving chain history also shows up as `balance_history_changed` rather than silently moving numbers, which is correct but visible.
- The journal grows with every correction. The volume is small: at most a few rows per multiplier change per wallet.
- Not yet covered: a mint that disappears from the registry leaves its open recognitions in place rather than reversing them, to avoid mass reversals from a transient verification failure.
