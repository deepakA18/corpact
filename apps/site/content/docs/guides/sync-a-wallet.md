---
title: Sync a wallet
description: Register a wallet, run its historical sync, and know when the ledger is ready.
---

## Request a sync

```ts
const { registration, status } = await corpact.requestSync(wallet);
```

This registers the wallet to your tenant (it needs `wallets:sync`) and queues a job. Requesting again while a sync is queued does not queue a second one.

## What a sync does

1. **Discovers token accounts.** The wallet's current supported token accounts, plus every account that appears in transactions the wallet signed. Closed accounts keep their history.
2. **Replays account histories.** Every transaction on those accounts is stored immutably, with its raw balance changes.
3. **Rebuilds each mint's multiplier timeline.** Issuer-schedule windows locate the writes, and the result is verified against the live mint state.
4. **Classifies every active change** against issuer evidence.
5. **Rebuilds positions** and appends the journal rows that bring recognized income in line.

## Wait for it

```ts
async function waitForSync(wallet: string) {
  for (;;) {
    const { sync } = await corpact.syncStatus(wallet);
    if (sync && !['queued', 'running'].includes(sync.status)) return sync;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const sync = await waitForSync(wallet);
// sync.status: 'complete' | 'partial' | 'failed'
```

While running, `progress` reports `{ phase, done, total }`.

| Status | Meaning |
|---|---|
| `complete` | No gaps; every position replayed from chain data |
| `partial` | The ledger is readable, but `gaps` lists what is missing (for example truncated history) |
| `failed` | `error` says why; request the sync again |

> [!NOTE] A queued job needs a worker
> Syncs run in the worker. If a sync stays `queued`, check that `pnpm start` is running in `apps/worker`, and read the `worker_heartbeat` check in [Monitoring](/docs/operations/monitoring).
