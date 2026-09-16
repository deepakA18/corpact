---
title: Overview
description: What Corpact is, what it gives you, and where to start.
---

Tokenized stocks pay dividends by **changing a multiplier on the mint**. Holders end up with more stock-equivalent units, yet no transaction touches their account, so anything that follows transfers sees nothing. Corpact reads those changes, proves what each one was, and turns them into an audit-ready ledger behind one API.

## Start here

<div class="card-grid">
<a class="doc-link-card" href="/docs/try-it"><span class="card-title">Try the API</span><span class="card-meta">1 minute, no setup</span><p>Run real requests against the hosted API from your browser, with a read-only demo key.</p></a>
<a class="doc-link-card" href="/docs/operations/demo"><span class="card-title">Run the demo</span><span class="card-meta">5 minutes, one command</span><p>The whole flow on a local Solana network with synthetic data, checked through the real API.</p></a>
<a class="doc-link-card" href="/docs/quickstart"><span class="card-title">Quickstart</span><span class="card-meta">15 minutes</span><p>Point the worker at mainnet, sync a wallet, and read its dividends, splits and coverage.</p></a>
<a class="doc-link-card" href="/docs/api-reference"><span class="card-title">API reference</span><span class="card-meta">Every endpoint</span><p>Generated from the same schemas the server validates against, so it cannot drift.</p></a>
</div>

> [!NOTE] Private preview
> Corpact runs on live Solana chain data with recorded issuer data (`ISSUER_SOURCE=fixtures`). The live issuer feed stays off until the data licence is settled.

## What you get

<div class="card-grid">
<a class="doc-link-card" href="/docs/actions"><span class="card-title">Corporate actions</span><p>Cash dividends, withholding refunds, splits, stock dividends, spin-offs, rights and identity changes, each with the evidence it requires.</p></a>
<a class="doc-link-card" href="/docs/concepts/classification"><span class="card-title">Classified from evidence</span><p>Matched to the issuer's own record on exact multipliers and activation time. Never from the size or label of a change.</p></a>
<a class="doc-link-card" href="/docs/concepts/protected-floor"><span class="card-title">Protected principal</span><p>Units that came from dividends stay separate from principal, and splits adjust the basis exactly.</p></a>
<a class="doc-link-card" href="/docs/concepts/coverage"><span class="card-title">Coverage on every number</span><p>A position is complete, partial or unsupported. Partial history never produces a yield claim.</p></a>
<a class="doc-link-card" href="/docs/concepts/corrections"><span class="card-title">Append-only journal</span><p>An issuer correction becomes a reversal plus a replacement. Nothing is ever edited.</p></a>
<a class="doc-link-card" href="/docs/operations/independent-provider"><span class="card-title">Reconciled to the chain</span><p>Every replay matches the exact raw balance, optionally cross-checked against a second RPC provider.</p></a>
</div>

## How the pieces fit

| Component | What it does |
|---|---|
| **Worker** | Reads chain history and mint state, rebuilds the multiplier timeline, classifies changes and replays positions into Postgres |
| **API** | Serves portfolio, income, corporate actions, journal, yield and exports to API keys scoped by tenant |
| **`@corpact/client`** | Typed TypeScript client generated from the same schemas as the API |
| **Dashboard** | A reference UI that calls the API through its own server |

## Next

<div class="card-grid">
<a class="doc-link-card" href="/docs/authentication"><span class="card-title">Authentication</span><p>Keys, scopes and tenant isolation.</p></a>
<a class="doc-link-card" href="/docs/guides/read-income"><span class="card-title">Read income</span><p>Entries, headlines, and what a null USD value means.</p></a>
<a class="doc-link-card" href="/docs/reference/client"><span class="card-title">TypeScript client</span><p>Every method, typed from the API contract.</p></a>
</div>
