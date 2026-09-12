# Parity

Unified liquidity and execution layer for tokenized equities on Solana.

The engineering specification is [`PLAN.md`](PLAN.md). It is the source of truth for scope and design. This README covers repository state and how to work in it.

## Status: Phase 0 complete, Phase 1 not started

No program code has been written. Spec §3 gates implementation behind investigation, and §13 says to start there.

**→ Read [`docs/findings/README.md`](docs/findings/README.md) first.** Phase 0 changed the plan in ways that matter before any code is written.

Three results in particular:

- **The normalization oracle should not be built.** The `shares_per_token` scalar is already on-chain in a Token-2022 `ScaledUiAmountConfig` on every candidate wrapper. §0.2 called a Parity-run oracle "the single greatest source of value leakage in this design"; it can be deleted from the design entirely. → [ADR-002](docs/adr/0002-normalization-from-scaled-ui-amount.md)
- **No wrapper has a transfer hook, but custody is revocable at any moment.** The §0.1 blocking risk did not materialise. Four unmodelled issuer powers did — live hook authorities, permanent delegates, global pause, freeze. → [ADR-003](docs/adr/0003-registry-tracks-issuer-powers.md)
- **§1's premise does not hold today.** Across 18 underlyings and $18.0M of on-chain liquidity, 3.7% is consolidatable, and 98% of that is one pre-IPO underlying the spec excludes from v1. xStocks is the deepest book in all 18. → [`liquidity-fragmentation.md`](docs/findings/liquidity-fragmentation.md)

Recommendation on record: **proceed with Phase 1 as specified; gate Phase 2 on Phase 1 data rather than on §1's premise.**

## Layout

```
programs/     Anchor programs                        (empty - Phase 1+)
reference/    Python reference math, source of truth (empty - Phase 2+)
services/     indexer, pricing, corpactions, risk, keeper, api  (empty - Phase 1+)
app/          Next.js frontend                       (empty - Phase 3+)
sdk/          TypeScript and Rust SDKs               (empty - Phase 6)
tools/
  phase0/     mainnet investigation tools            <- the only code here today
docs/
  findings/   Phase 0 deliverables + raw evidence
  adr/        architecture decision records
  toolchain.md
tests/        fuzz, integration, fork                (empty)
```

`tools/` is not in the spec's §4.1 layout. It holds throwaway-but-reproducible investigation scripts, kept because every number in `docs/findings/` should be re-derivable rather than trusted.

## Toolchain

Pinned per §4.2 — see [`docs/toolchain.md`](docs/toolchain.md). Rust 1.91.0 (`rust-toolchain.toml`), Solana CLI 4.0.0, Anchor 0.32.1, Node 24.8.0.

`Anchor.toml` does not exist yet; pin `anchor_version` and `solana_version` there when the first program is scaffolded.

## Reproducing Phase 0

```bash
cd tools/phase0
npm install
node inspect-mints.js
```

See [`tools/phase0/README.md`](tools/phase0/README.md) for the full set. A public RPC works for most of it but throttles hard; set `SOLANA_RPC_URL` to an archival provider for anything historical.

## Working agreements

From §13, plus what Phase 0 added:

- **Python reference first, always.** For every math module the arbitrary-precision Python implementation is the source of truth; Rust is verified against it by differential test. Never write the Rust first.
- **Do not derive Orbital or TWAMM math from memory.** Fetch the papers. Where a formulation is ambiguous, write an ADR and take the pool-favouring reading.
- **No floating point in program code.** Every rounding decision explicit and directional. Note that wrapper multipliers arrive as IEEE-754 `f64` on-chain — convert on the raw bits with integer arithmetic, and reject out-of-band values rather than rounding them. → [ADR-002](docs/adr/0002-normalization-from-scaled-ui-amount.md)
- **Ask before adding a dependency** to any program crate. Audit surface is the scarce resource.
- **Write the ADR before the code** for any decision the spec leaves open.
- **Never allowlist a wrapper by symbol.** Impostor mints with identical names and symbols are live right now. Identity is the mint pubkey, and admission diligence is on the mint authority. → [`token-extensions.md`](docs/findings/token-extensions.md) §6
- **A failed measurement must never be reported as a zero.** Phase 0 hit this twice: a rate-limited quote read as "no liquidity", and an auth failure read as "market closed". Both would have gone into a finding as fact. Probes distinguish *absent* from *unavailable*, and control cases (an always-on feed, a known-good mint) are how you tell them apart.
- **When you disagree with the spec, argue the case.** §13 invites this; `docs/findings/liquidity-fragmentation.md` is what taking it seriously looks like.
