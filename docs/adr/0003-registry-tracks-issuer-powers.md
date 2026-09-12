# ADR-003 — `registry` tracks live issuer powers, not just admission-time facts

**Status:** Accepted · **Date:** 2026-09-12 · **Amends:** spec §5.1, §7.2, §8.1

## Context

§5.1's `Wrapper` struct models transfer-policy risk with two fields: `has_transfer_hook: bool` and `hook_program: Option<Pubkey>`. That models the risk §0.1 expected to find.

[`token-extensions.md`](../findings/token-extensions.md) found the opposite situation. **No candidate wrapper has a transfer hook installed** — so the modelled risk does not currently exist — while four unmodelled issuer powers do:

| Power | Wrappers | Effect on a pool |
|---|---|---|
| Hook authority live | all 8 | A hook can be installed in one transaction, no notice |
| `PermanentDelegate` | NVDAx, AAPLx, SPCXx, SPCX | Pool assets removable outright, no recourse |
| `PausableConfig` | all 8 | All transfers of that wrapper halt globally |
| Freeze authority | all 8 | A specific pool vault becomes untransferable |

Every live pool vault observed already carries the `TransferHookAccount` extension, so hook installation requires no holder migration and gives no warning window.

## Decision

**`registry` treats issuer powers as live monitored state, not admission-time constants.**

1. `Wrapper` gains: `permanent_delegate: Option<Pubkey>`, `pausable_authority: Option<Pubkey>`, `pausable_paused: bool`, `freeze_authority: Option<Pubkey>`, `hook_authority: Option<Pubkey>`, `default_account_state: u8`.
2. `Wrapper` gains `extension_fingerprint: [u8; 32]` — a hash over the full decoded extension set of the mint. **Any change to the fingerprint automatically trips `DepositsPaused`.** Restoring requires governance review, never an automatic clear.
3. `has_transfer_hook` stays but is re-typed as monitored live state, not an admission-time flag.
4. The §8.1 indexer subscription extends to **wrapper mint accounts and pool vault accounts**, not only program accounts. A mint write must reach a state transition in seconds.
5. §7.2's circuit-breaker table gains rows for issuer transfer-policy changes (see below).
6. `issuer_tier` splits into two independent axes (see below).

### Added circuit-breaker rows

| Trigger | Action |
|---|---|
| Mint `extension_fingerprint` changes | `DepositsPaused` immediately; governance review to clear |
| `transfer_hook.program_id` becomes non-null | `Frozen` — exclude from routing; proportional withdrawal only |
| `pausable.paused` becomes true | `Frozen` — that leg cannot transfer at all |
| Pool vault state becomes `Frozen` | `Frozen` + incident; `withdraw_proportional` is degraded (see below) |
| Vault balance falls with no matching pool instruction | `Frozen` + incident — probable permanent-delegate seizure |

### Two tier axes, not one

§5.1's single `IssuerTier` ladder conflates custodial quality with on-chain seizure risk. Backpack SPCX is the strongest candidate on §5.1's own Tier 1 definition — "redeemable into the real security through recognised rails" — *and* holds a permanent delegate. Ondo is the weakest on redemption depth and the only issuer with **no** permanent delegate.

These are independent and must be scored independently:

- `custody_tier` — redemption path quality, regulatory standing, attestation currency. §5.1's existing ladder.
- `onchain_risk_tier` — seizure, pause and freeze powers held by the issuer.

`max_weight_bps` is derived from **both**, taking the more restrictive.

## Reasoning

The spec's risk model was built around the PreStocks case: a *legal* failure that "arrived as a public notice hours before the price moved" (§7.2). §0.1 shows the faster and quieter failure mode is an issuer transaction with no notice at all. A `bool` set at admission cannot represent a power that can be exercised at any moment.

Automatic pause on fingerprint change is deliberately blunt. We cannot enumerate in advance every way an issuer might reconfigure a mint, so the safe default is: **any change we did not expect stops new deposits until a human looks.** This is consistent with §7.2's asymmetry — breakers may always restrict, lifting always requires governance.

## Consequences

- Larger `Wrapper` account; rent and a migration path if fields are added later.
- More indexer subscriptions, and a latency budget on the mint-write → state-transition path that must be measured.
- False-positive pauses on benign issuer maintenance. Accepted: a spurious `DepositsPaused` costs deposit availability; a missed seizure costs principal.
- Admission diligence grows — every power must be identified and attributed to a named controlling entity.

## Unresolved dependency

`withdraw_proportional` is §5.2's run-safety valve: "it cannot be gamed to exit the good assets and leave the bad ones behind." A frozen or seized leg breaks it — a strictly proportional withdrawal either reverts for everyone or must deliver short.

This ADR makes the failure *detectable*. It does not make it *survivable*. **A separate ADR must define proportional-withdrawal behaviour under an undeliverable leg, and it blocks `parity_pool`.**
