# Finding 0.1 — Token-2022 extensions and PDA custody

**Status:** complete for the candidate set · **Verdict:** Tier 1 pooling is technically viable, but not for the reason the spec expected, and the real risk is different from the one it names.

| | |
|---|---|
| Scope | 8 wrapper mints across 4 underlyings (NVDA, AAPL, TSLA, SPCX), 3 issuers |
| Observed | mainnet, 2026-09-12 |
| Reproduce | `node tools/phase0/inspect-mints.js` and `node tools/phase0/pda-custody-check.js` |
| Raw evidence | [`evidence/token-extensions-20260912.json`](evidence/token-extensions-20260912.json) |

---

## 1. Headline

The spec's highest-risk item was: *"If a hook rejects transfers to or from a program-owned PDA, Tier 1 cannot custody that wrapper at all."*

**No candidate wrapper has a transfer hook installed.** On all eight mints the `TransferHook` extension is present but its `program_id` is the null address `11111111111111111111111111111111`. There is no eligibility predicate to satisfy, no extra-account-metas PDA to resolve, and no allowlist to join. Tier 1 can custody all eight today.

That is the good news, and it is narrower than it looks. Three findings displace the one we were worried about:

**(a) Every issuer retains a live hook authority.** The `TransferHook` extension's `authority` field is non-null on all eight mints. Any issuer can install a hook in a single transaction, with no notice, and gate transfers from that slot onward.

**(b) Every live pool vault already carries `TransferHookAccount`.** Token accounts holding these wrappers are *already* hook-ready. There is no migration step that would give us warning. The moment an authority sets a hook program, existing pool vaults are subject to it — including ours.

**(c) xStocks and Backpack hold a `PermanentDelegate` over their tokens.** That is an unconditional, unilateral power to move tokens out of any account, including a Parity pool vault, with no user or program consent. Ondo does not have one.

So the question changes from *"can we custody this?"* to *"what happens to depositors when an issuer revokes custody from under us?"* — which is a risk-engine and disclosure problem, not an architecture blocker.

## 2. Per-mint matrix

All eight mints are owned by **Token-2022** (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). None is an SPL Token mint.

| Wrapper | Mint | Dec | Supply | Ext | PermDelegate | Hook set | Hook authority live | Pausable | Confidential |
|---|---|---|---|---|---|---|---|---|---|
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | 8 | 321,280 | 8 | **YES** | no | yes | yes | yes |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | 8 | 153,764 | 8 | **YES** | no | yes | yes | yes |
| SPCXx | `Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8` | 8 | 559,994 | 8 | **YES** | no | yes | yes | yes |
| NVDAon | `gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo` | 9 | 16,722 | 7 | no | no | yes | yes | yes |
| AAPLon | `123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo` | 9 | 365 | 7 | no | no | yes | yes | yes |
| TSLAon | `KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo` | 9 | 399 | 7 | no | no | yes | yes | yes |
| SPCXon | `wzAyQTorWyoVXuJKj2x8EqKEGJpS13z6EWE9z5Aondo` | 9 | 1,309 | 7 | no | no | yes | yes | yes |
| SPCX | `SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb` | 6 | 43,339 | 8 | **YES** | no | yes | yes | yes |

`DefaultAccountState` is present on all eight and is set to **`Initialized`**, not `Frozen`. A freshly created pool ATA is immediately usable; no thaw step is required. This is a live setting, not a structural guarantee — the same authority can flip it to `Frozen`, which would block *new* pool vaults without touching existing ones.

`NonTransferable`, `TransferFeeConfig` and `MintCloseAuthority` are **absent everywhere**. There is no transfer tax to model and no mint that can be closed out from under a pool.

### Authority keys

Authorities are shared across an issuer's whole product line — one key compromise is an issuer-wide event, not a per-ticker one.

| Issuer | Mint authority | Freeze authority | Permanent delegate | Hook authority | ScaledUiAmount authority |
|---|---|---|---|---|---|
| xStocks | `7pt9tkct…rtaCj` | `JDq14BWv…xJNs` | `5aMNNLQJ…HFvEq` | `5aMNNLQJ…HFvEq` | `S7vYFFWH…JuRaS` |
| Ondo | `9foMHsSD…5cUxD` | `51QVCuHf…hiuK` | — | `9foMHsSD…5cUxD` | `9foMHsSD…5cUxD` |
| Backpack | `HK6jF79d…KcXctZ` | `2cVYpagT…Daf4a` | `2cVYpagT…Daf4a` | `2cVYpagT…Daf4a` | `HK6jF79d…KcXctZ` |

Ondo reuses a **single key** for mint, hook and multiplier authority. That is a tighter blast radius per key but a wider one per compromise. xStocks separates the normalization authority (`S7vY…`) from the transfer-policy authority (`5aMN…`), which is the better split for our purposes: an xStocks multiplier-key compromise cannot also freeze our vaults.

## 3. PDA custody is proven in production, not just permitted

The spec asks for empirical confirmation on a fork. We have something stronger: wrappers are already custodied by program PDAs on mainnet, at size, with transfers flowing daily.

`getTokenLargestAccounts` is an indexed call and is paywalled on every free RPC, so `pda-custody-check.js` works from the other end — it finds live AMM pools quoting each wrapper, scans the pool account for embedded pubkeys, and keeps those that resolve to token accounts of that mint. Nine vaults found:

| Wrapper | Vault | Balance | Authority | State | Account extensions |
|---|---|---|---|---|---|
| NVDAx | `DyKsypuz…rSSe` | 4,879.62 | Raydium CLMM pool PDA | Initialized | `PausableAccount`, `TransferHookAccount` |
| NVDAx | `8yUe5to4…eFeX` | 283.42 | Raydium CLMM pool PDA | Initialized | `PausableAccount`, `TransferHookAccount` |
| AAPLx | `3DRUhhz5…9Tn7` | 257.17 | Raydium CLMM pool PDA | Initialized | `PausableAccount`, `TransferHookAccount` |
| AAPLx | `69u6oEwR…kXuj` | 349.66 | Raydium CLMM pool PDA | Initialized | `ImmutableOwner`, `PausableAccount`, `TransferHookAccount` |
| SPCXx | `2wmq9Loq…HYoa` | 2,530.98 | Raydium CLMM pool PDA | Initialized | `PausableAccount`, `TransferHookAccount` |
| SPCXx | `68zVKnQX…QAFq` | 456.90 | Meteora DLMM pool PDA | Initialized | `PausableAccount`, `TransferHookAccount` |
| SPCX | `9DTssx5A…agTu` | 2,767.70 | Meteora DLMM pool PDA | Initialized | `PausableAccount`, `TransferHookAccount` |
| SPCX | `2iM4Qur7…jJn8` | 1,395.72 | Raydium CLMM pool PDA | Initialized | `PausableAccount`, `TransferHookAccount` |
| AAPLon | `GqWws4zC…1dJ6` | 2.60 | Meteora DLMM pool PDA | Initialized | `PausableAccount`, `TransferHookAccount` |

None is frozen. None carries a delegate. Every vault's `owner` field is the pool PDA itself.

Answering the spec's questions directly:

- *Can a PDA hold the token?* Yes, for all eight — demonstrated for six, and the two with no live pool (NVDAon, TSLAon, SPCXon) share a mint configuration byte-for-byte identical to AAPLon, which is demonstrated.
- *Can a CPI-initiated transfer to and from that PDA succeed?* Yes. These are actively traded CLMM pools; every swap is a CPI transfer in and out of these vaults.
- *Does the hook require the owner to be on an allowlist?* Not applicable today — no hook is installed on any candidate mint.

**Caveat worth stating plainly:** this establishes that custody works *under today's issuer configuration*. It establishes nothing about tomorrow's. See §5.

## 4. `ScaledUiAmountConfig` — the finding that changes the architecture

All eight mints carry `ScaledUiAmountConfig`. This is the single most consequential result in Phase 0 and it is covered in full in [`normalization-sources.md`](normalization-sources.md). The short version:

**The `shares_per_token` scalar that §0.2 assumed we would have to source from issuer APIs is already on-chain, on the mint, readable in the same account load as the balance.** It also carries a *scheduled* effective timestamp for the next value.

This removes the spec's stated "single greatest source of value leakage" — a permissioned off-chain oracle authority writing a scalar — from the design. See [ADR-002](../adr/0002-normalization-from-scaled-ui-amount.md).

## 5. The real risk: revocable custody

Restating the risk in the form the risk engine has to handle. Each row is a unilateral issuer action requiring one transaction and no notice:

| Issuer action | Effect on a Parity pool | Detectable how | Wrappers exposed |
|---|---|---|---|
| Install a transfer hook | Swaps and withdrawals may revert; vaults may become untransferable | Mint account write — `transfer_hook.program_id` becomes non-null | all 8 |
| `PermanentDelegate` transfer | Pool assets removed outright; `pTICKER` becomes undercollateralised with no on-chain recourse | Vault balance drops with no matching pool instruction | NVDAx, AAPLx, SPCXx, SPCX |
| `Pausable` → paused | All transfers of that wrapper halt globally; `withdraw_proportional` cannot deliver that leg | Mint account write — `pausable.paused` becomes true | all 8 |
| Freeze the pool vault | That wrapper's leg is stuck; proportional withdrawal breaks | Vault account state becomes `Frozen` | all 8 |
| `DefaultAccountState` → `Frozen` | New pool vaults unusable; existing ones unaffected | Mint account write | all 8 |

Two of these — permanent-delegate seizure and vault freeze — **break `withdraw_proportional`**, which §5.2 designates as the run-safety valve that "cannot be gamed to exit the good assets and leave the bad ones behind." If one leg of the basket cannot be delivered, a strictly proportional withdrawal either reverts for everyone or must be allowed to deliver short. That is an unresolved design question in the spec and it is load-bearing for the whole safety story. Flagged for ADR before `parity_pool` is written.

### Required mitigations

1. **The indexer must subscribe to wrapper mint accounts, not just program accounts.** §8.1 scopes the Yellowstone subscription to "program accounts and transactions". That would miss every row in the table above. Mint and vault accounts must be in the subscription set, with a sub-second path from a mint write to a `Frozen` state transition in `registry`.
2. **`registry.Wrapper` needs fields the spec's struct does not have:** `permanent_delegate: Option<Pubkey>`, `pausable_authority: Option<Pubkey>`, and an `extension_fingerprint: [u8; 32]` hashed over the full decoded extension set. Any change to the fingerprint trips an automatic `DepositsPaused`. The spec's `has_transfer_hook: bool` / `hook_program: Option<Pubkey>` pair is too narrow — it models the one risk that turned out not to exist while missing the four that do.
3. **Issuer tiering must account for the permanent delegate.** §5.1 Tier 1 is defined as "redeemable into the real security through recognised rails". By that definition Backpack SPCX is the strongest candidate — and it also holds a permanent delegate. Custodial quality and on-chain seizure risk are *independent axes* and collapsing them into one tier ladder will misprice one of them.

## 6. Symbol collisions — allowlist by mint, never by symbol

Searching a public token API for these tickers returns impostors with identical names:

| Query | Legitimate mint | Impostor(s) found |
|---|---|---|
| `NVDAon` | `gEGtLTPN…ondo` | `LNe8SGaL…pump` — name *"NVIDIA (Ondo Tokenized)"*, Token-2022, 6 decimals |
| `AAPLon` | `123mYEnR…ondo` | `GNW3jmnD…FhxW` — name *"Apple (Ondo Tokenized)"*, SPL Token |
| `TSLAon` | `KeGv7bsf…ondo` | `G2nUf9jh…ki9a` — symbol `TSLAon`, SPL Token |

Both real issuers use vanity mint prefixes/suffixes (`Xs…` for xStocks, `…ondo` for Ondo, `SPCX…` for Backpack), which helps human review but is trivially imitable and must never be load-bearing in code. `registry` admission is by **mint pubkey only**. The frontend must resolve display names from `registry`, never from a token list.

## 7. Go / no-go

| Wrapper | Verdict | Reasoning |
|---|---|---|
| NVDAx | **Go**, capped | Custody proven, deepest book in the set, no hook. Permanent delegate caps max weight. |
| AAPLx | **Go**, capped | As above. |
| SPCXx | **Go**, capped | As above. Pre-IPO underlying — see note below. |
| SPCX (Backpack) | **Go**, capped | Custody proven. Strongest redemption story, but permanent delegate and a third-party metadata host (`trek-labs.github.io`) both warrant diligence. |
| NVDAon | **Go**, low cap | No permanent delegate — structurally the safest custody profile in the set. But 16,722 tokens outstanding and **zero live pools**; it contributes basket diversification, not depth. |
| AAPLon | **Go**, low cap | Custody proven. 365 tokens outstanding. Negligible depth. |
| TSLAon, SPCXon | **Go**, low cap | Same profile; no live pools. |

No wrapper in the candidate set is a no-go on transfer-policy grounds. The escalation path in §0.1 ("if the top two issuers both block PDA custody, the product needs a different shape") is **not triggered**.

**Separate concern, not a custody one:** SPCX is pre-IPO SpaceX exposure and §10 lists pre-IPO assets as an explicit v1 non-goal. SPCX/SPCXx/SPCXon are included here because they are the only underlying in the set with three competing wrappers and meaningful depth on two of them, which makes them the best available *test* of the parity thesis. They should be excluded from the first production pools on the spec's own terms.

## 8. Consequences for the spec

1. §0.1's escalation condition is not met — proceed with the pooling architecture.
2. §5.1 `Wrapper` state is underspecified. Add permanent-delegate, pausable and extension-fingerprint tracking; treat `has_transfer_hook` as a live-monitored field rather than an admission-time constant.
3. §8.1 indexer scope must extend to mint and vault accounts.
4. §7.2's circuit-breaker table needs rows for issuer-side transfer-policy changes, which are faster and quieter than the legal events the table was designed around.
5. §5.2's `withdraw_proportional` guarantee does not survive a single frozen or seized leg. Resolve before implementation.
6. Wrapper decimals differ across issuers (6 / 8 / 9). Normalization must fold decimals in, not just the multiplier. See [ADR-002](../adr/0002-normalization-from-scaled-ui-amount.md).

## 9. Open items

- [ ] Fork test: install a transfer hook on a cloned mint and confirm `registry` detects it and halts before a swap can revert mid-flight.
- [ ] Fork test: exercise permanent-delegate seizure against a pool vault and confirm the accounting response.
- [ ] Diligence: who controls `5aMNNLQJ…HFvEq` (xStocks) and `2cVYpagT…Daf4a` (Backpack)? Multisig or single key? Published policy on delegate use?
- [ ] Confirm `trek-labs.github.io` metadata hosting for Backpack SPCX is intentional and not a stale pointer.
- [ ] Read the Ondo program source (`github.com/ondoprotocol/global-markets-solana`) — its README describes a `Whitelist` account and secp256k1-attested mint/redeem. No hook is installed today, but that repo is the most likely shape of one if it is.
