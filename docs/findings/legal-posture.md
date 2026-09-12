# Finding 0.3 — Legal posture

**Status:** ⛔ **blocked — requires external counsel.** This document is not legal analysis and must not be treated as any. It is the engineering-side brief: what counsel needs to be asked, and what Phase 0's technical findings changed about the questions.

**Gate restated:** §0.3 says *"Do not ship mainnet without this memo."* That gate is unmet and nothing in this document moves it. Devnet and testnet work may proceed in parallel, per the same section.

---

## 1. Why this is not answerable in-house

§0.3 asks whether Parity is a non-custodial protocol, an issuer, or both; whether the canonical token is itself a security; what geofencing applies; and whether pooling wrappers with different legal characteristics creates a disclosure obligation.

Each is a question of securities law in a specific jurisdiction, applied to a novel instrument. No amount of on-chain investigation substitutes for a written memo from qualified counsel. The operating jurisdiction has not been fixed, which is itself the first blocker — the answers differ substantially across the plausible candidates.

## 2. What Phase 0 changed about the questions

Three technical findings materially reshape what counsel should be asked. Bringing these to a first engagement will save a round trip.

### 2.1 The wrappers are more legally heterogeneous than §1 assumed, and we can now prove it on-chain

[`token-extensions.md`](token-extensions.md) establishes that the candidate wrappers differ not only in legal characterisation — bearer debt instrument (xStocks), custody-backed tracker (Ondo), UCC Article 8 security entitlement (Backpack) — but in **enforceable on-chain issuer powers**:

- xStocks and Backpack hold a `PermanentDelegate` over their tokens: unilateral power to move a holder's tokens without consent.
- Ondo does not.
- All three hold freeze and global-pause authority.

A pool that mixes these is mixing instruments whose holders have *different rights against the issuer* and different exposure to seizure. §7.3 already requires prominent disclosure that "the canonical token socializes wrapper risk in exchange for depth." Counsel should advise whether that socialisation, across instruments with materially different legal characteristics and issuer powers, is adequately addressed by disclosure alone.

### 2.2 `pTICKER` has an unresolved economic character

[`normalization-sources.md`](normalization-sources.md) §7 identifies an open design question with a legal dimension: the wrappers accrue dividends via their multipliers, so the pool accumulates a surplus of shares over `pTICKER` claims. Where that surplus goes is undecided.

The three candidate answers are not legally equivalent:

- **Accrue to LPs** — `pTICKER` holders' dividend economics are redirected to a different class of participant.
- **Rebase `pTICKER`** — `pTICKER` distributes an income stream to holders.
- **Periodic sweep** — a discretionary distribution mechanism.

This should be settled *with* counsel rather than chosen on engineering grounds and reviewed afterwards. It is the closest thing in the design to a question of what `pTICKER` actually is.

### 2.3 The commercial case for pooling is weaker than §1 assumed

[`liquidity-fragmentation.md`](liquidity-fragmentation.md) finds only ~3.7% of on-chain liquidity is consolidatable, and ~98% of that is SPCX — pre-IPO SpaceX, an explicit v1 non-goal under §10.

This matters for sequencing. A legal engagement scoped to "an N-asset pool over tokenized securities plus a new canonical token" is materially more expensive and slower than one scoped to "a read-only public analytics dashboard" — which is all Phase 1 requires. Given Phase 2 is no longer clearly justified on the data, **scoping the first engagement to Phase 1 and returning for Phase 2 when the data supports it** is the proportionate path.

### 2.4 SPCX raises questions §0.3 does not currently cover

If SPCX enters scope — and [`liquidity-fragmentation.md`](liquidity-fragmentation.md) §5 shows it is the only underlying where the thesis demonstrably holds — the review must extend to pre-IPO private-company exposure. §1 already flags SPV-based pre-IPO structures as the category that produced the May 2026 transfer-void losses. Backpack SPCX is *not* an SPV wrapper, but the distinction is precisely the kind that needs stating in a memo rather than assuming.

## 3. Questions for counsel

Grouped so an engagement can be scoped to Phase 1 alone.

### Phase 1 — analytics only (no pooling, no token, no custody)

1. Does publishing a public dashboard of prices, basis, depth and issuer-risk metadata for third-party tokenized securities create any registration, licensing or market-data obligation in the operating jurisdiction?
2. Does publishing an issuer-tier assessment (§5.1 Tier 1/2/3) constitute investment advice, a credit-rating activity, or a regulated benchmark?
3. Does republishing issuer attestations and corporate-action data carry a duty of accuracy, and what disclaimer regime applies?
4. What geofencing, if any, applies to a read-only analytics surface?

### Phase 2+ — pooling and the canonical token

5. Is `pTICKER` a security in its own right, separate from the wrappers backing it?
6. Is Parity a non-custodial protocol, an issuer, or both? Does holding user assets in program PDAs constitute custody in this jurisdiction?
7. Must `pTICKER` itself carry a transfer hook or other on-chain transfer restriction? Note that §0.1 found *no* candidate wrapper currently enforces one, so this would make `pTICKER` **more** restricted than its backing — with consequences for the §12 integration thesis.
8. Does pooling instruments with different legal characteristics, and different issuer seizure powers, create a disclosure obligation beyond §7.3's plain-language statement? Does it create liability if one issuer exercises those powers?
9. What is the correct treatment of the dividend-accrual surplus (§2.2)? Does each option change what `pTICKER` is?
10. Do the issuer terms of service for xStocks, Ondo and Backpack permit a third party to pool their tokens and issue a derivative claim against them? **This is contractual, checkable now, and should be read before any engagement.**
11. If an issuer exercises `PermanentDelegate` against a pool vault, what is Parity's obligation to affected `pTICKER` holders?
12. Does pre-IPO exposure (SPCX) change any of the above?

## 4. Immediate, non-blocking actions

These do not require counsel and should happen regardless:

- [ ] **Read the issuer terms of service** for xStocks (Backed Finance), Ondo Global Markets and Backpack Securities. Question 10 may be answerable from public documents and may constrain the design before any legal spend.
- [ ] **Fix the operating jurisdiction.** Everything else is downstream of it.
- [ ] **Write the §7.3 loss-mutualization disclosure now**, in plain language, as a design input rather than a compliance artefact. If it cannot be stated clearly and honestly, the design is wrong. It must cover: permanent delegate seizure, global pause, vault freeze, and the fact that one issuer failing is a haircut to every `pTICKER` holder.
- [ ] **Draft the incident disclosure runbook** (§10.7) for an issuer exercising an on-chain power. §7.2 targets legal events arriving as public notices hours ahead; the powers in §0.1 arrive in a single transaction with no notice at all.

## 5. Recommendation

**Scope the first legal engagement to Phase 1 only.** Phase 1 ships a public basis dashboard with no pooled funds, no new token and no custody — §11 already designs it to stand alone. Its legal surface is small and the questions in §3 are answerable quickly and cheaply.

Defer the Phase 2 engagement until [`liquidity-fragmentation.md`](liquidity-fragmentation.md) §7's go/no-go conditions are met. Paying for a full securities analysis of a pooling product whose commercial premise is currently unsupported by the data is the wrong order of operations.

**This recommendation is about sequencing and spend, not about legal risk, and it is not a substitute for the memo §0.3 requires.**
