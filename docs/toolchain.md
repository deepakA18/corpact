# Toolchain

Pinned versions, per spec §4.2. Recorded 2026-09-12 from the development machine.

| Tool | Version | Pinned in |
|---|---|---|
| Rust | 1.91.0 | `rust-toolchain.toml` |
| Solana CLI | 4.0.0 (Agave, `src:a5517b29`) | this file; pin in `Anchor.toml` when programs land |
| Anchor CLI | 0.32.1 | this file; pin in `Anchor.toml` when programs land |
| Node | 24.8.0 | `tools/phase0/package.json` engines (to add) |
| Python | 3.9.6 (system) | see note |

## Notes

- `Anchor.toml` does not exist yet. Phase 0 is investigation only and no program
  code has been written (spec §13: "Start at Phase 0"). Pin `anchor_version` and
  `solana_version` there when the first program is scaffolded.
- **Python 3.9 is too old for the reference implementations.** §4.2 requires
  `mpmath` arbitrary precision for `reference/*.py`, and the reference suite
  should target 3.11+ for typing and performance. Provision a managed Python
  (uv or pyenv) before Phase 2 rather than relying on macOS system Python.
- Mainnet RPC: public endpoints paywall indexed calls (`getTokenLargestAccounts`)
  and throttle `getTransaction` heavily. An archival provider is required for the
  Phase 1 indexer and for completing the multiplier-cadence measurement in
  `docs/findings/normalization-sources.md` §11.
