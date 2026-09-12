/**
 * Phase 0 / §0.2 - multiplier update cadence and advance notice.
 *
 * §0.2 asks for update frequency, authority and whether history is queryable.
 * The mint account itself is touched by every transfer, so it is useless as a
 * filter. The ScaledUiAmountConfig *authority* is not - it signs little else.
 *
 * For each update we recover both the block time (when the write landed) and
 * the new multiplier's effective timestamp (when it takes economic effect).
 * The gap between them is the advance notice the protocol gets before a
 * corporate action repricess a wrapper - which decides whether `registry` can
 * pause swaps *before* the step or only react after being arbitraged across it.
 *
 * Token-2022 ScaledUiAmountMint instruction (discriminator 43):
 *   [0] = 43 (ScaledUiAmountExtension)
 *   [1] = 1  (UpdateMultiplier)
 *   [2..10]  = new multiplier          f64 LE
 *   [10..18] = effective timestamp     i64 LE
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'mints.json'), 'utf8'));
const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SCALED_UI_EXT = 43;
const UPDATE_MULTIPLIER = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AUTHORITIES = {
  'S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS': 'xStocks / Backed Finance',
  '9foMHsSDq7nMg4WPusSz9eY7tyxyukqborA8GyU5cUxD': 'Ondo Global Markets',
  HK6jF79duLLLfCMRQFBSgo6CgQ5mF4tFMFU7CmKcXctZ: 'Backpack Securities',
};

const MINT_NAMES = Object.fromEntries(
  Object.entries(cfg.underlyings).flatMap(([u, es]) => es.map((e) => [e.mint, `${u}/${e.symbol}`]))
);

const iso = (s) => new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 19);

/**
 * Scanning an issuer authority's whole signature stream is hopeless - the
 * xStocks key signs ~180 transactions a day and a multiplier update is a
 * handful a month. Instead, page signatures back to a target window (cheap,
 * 1000 per call) and only fetch full transactions inside it.
 *
 * WINDOW_FROM/WINDOW_TO are unix seconds; default covers the observed NVDAx
 * step effective 2026-09-10T00:30:00Z with two days of lead-time headroom.
 *
 * LIMITATION: public RPC signature history is shallow and heavily throttled, so
 * a full cadence series needs an archival provider. What this tool can settle
 * cheaply is whether a write landed AT its effective instant (no notice) or
 * before it (staged) - which is the part that changes registry's design.
 */
const WINDOW_TO = Number(process.env.WINDOW_TO ?? 1789004000);   // 2026-09-10 01:33Z
const WINDOW_FROM = Number(process.env.WINDOW_FROM ?? 1788739200); // 2026-09-07 00:00Z

async function signaturesInWindow(conn, address, from, to) {
  const collected = [];
  const seen = new Set();
  let before;
  for (let page = 0; page < 20; page++) {
    const batch = await conn.getSignaturesForAddress(address, { limit: 1000, before }, 'confirmed');
    if (!batch.length) break;
    for (const s of batch) {
      if (s.blockTime == null || s.err || seen.has(s.signature)) continue;
      seen.add(s.signature);
      if (s.blockTime <= to && s.blockTime >= from) collected.push(s);
    }
    const oldest = batch.at(-1);
    // Stop as soon as the page's oldest entry predates the window. Guard against
    // an endpoint that ignores `before` and replays the same page: without the
    // advance check this loops 20 times and double-counts every signature.
    const exhausted = oldest.signature === before || (oldest.blockTime != null && oldest.blockTime < from);
    process.stderr.write(`\r  paged ${page + 1}: back to ${iso(oldest.blockTime)}, ${collected.length} in window   `);
    if (exhausted) break;
    before = oldest.signature;
    await sleep(150);
  }
  process.stderr.write('\n');
  return collected;
}

for (const [authority, label] of Object.entries(AUTHORITIES)) {
  console.log(`\n${'='.repeat(92)}\n${label}   authority ${authority}`);
  console.log(`  window ${iso(WINDOW_FROM)} .. ${iso(WINDOW_TO)}`);
  let sigs;
  try {
    sigs = await signaturesInWindow(conn, new PublicKey(authority), WINDOW_FROM, WINDOW_TO);
  } catch (err) {
    console.log(`  signature fetch failed: ${err.message}`);
    continue;
  }
  console.log(`  ${sigs.length} signatures inside the window`);

  // Serial fetching against a public RPC takes tens of minutes for a few
  // hundred signatures. Fetch in bounded-concurrency waves instead.
  const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
  const ok = sigs.filter((s) => !s.err);
  const updates = [];

  for (let i = 0; i < ok.length; i += CONCURRENCY) {
    const wave = await Promise.all(ok.slice(i, i + CONCURRENCY).map(async (s) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return [s, await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })];
        } catch { await sleep(400 * (attempt + 1)); }
      }
      return [s, null];
    }));

    for (const [s, tx] of wave) {
      if (!tx) continue;
      const keys = tx.transaction.message.getAccountKeys({
        accountKeysFromLookups: tx.meta?.loadedAddresses,
      });
      for (const ix of tx.transaction.message.compiledInstructions ?? []) {
        if (keys.get(ix.programIdIndex)?.toBase58() !== T22) continue;
        const data = Buffer.from(ix.data);
        if (data.length < 18 || data[0] !== SCALED_UI_EXT || data[1] !== UPDATE_MULTIPLIER) continue;
        const mint = keys.get(ix.accountKeyIndexes[0])?.toBase58();
        updates.push({
          signature: s.signature,
          blockTime: s.blockTime,
          mint,
          name: MINT_NAMES[mint] ?? '(other mint)',
          multiplier: data.readDoubleLE(2),
          effectiveAt: Number(data.readBigInt64LE(10)),
        });
      }
    }
    process.stderr.write(`\r  scanned ${Math.min(i + CONCURRENCY, ok.length)}/${ok.length}, ${updates.length} updates found   `);
    await sleep(60);
  }
  process.stderr.write('\n');

  if (!updates.length) { console.log('  no UpdateMultiplier instructions found in this window'); continue; }

  updates.sort((a, b) => a.blockTime - b.blockTime);
  console.log(`  ${updates.length} UpdateMultiplier instructions\n`);
  console.log(`  ${'mint'.padEnd(14)} ${'written'.padEnd(20)} ${'effective'.padEnd(20)} ${'notice'.padEnd(12)} multiplier`);
  for (const u of updates) {
    const noticeSec = u.effectiveAt - u.blockTime;
    const notice = u.effectiveAt === 0 ? 'n/a'
      : noticeSec >= 0 ? `+${(noticeSec / 3600).toFixed(1)}h ahead`
      : `${(noticeSec / 3600).toFixed(1)}h RETRO`;
    console.log(`  ${u.name.padEnd(14)} ${iso(u.blockTime).padEnd(20)} ${(u.effectiveAt ? iso(u.effectiveAt) : '(unset)').padEnd(20)} ${notice.padEnd(12)} ${u.multiplier}`);
  }

  const tracked = updates.filter((u) => MINT_NAMES[u.mint]);
  const notices = updates.filter((u) => u.effectiveAt).map((u) => u.effectiveAt - u.blockTime);
  if (notices.length) {
    const min = Math.min(...notices), max = Math.max(...notices);
    console.log(`\n  advance notice: min ${(min / 3600).toFixed(1)}h, max ${(max / 3600).toFixed(1)}h`);
    console.log(`  ${min >= 0 ? 'All updates were scheduled ahead - registry CAN pause before the step.'
      : 'At least one update took effect retroactively - registry CANNOT rely on advance notice.'}`);
  }
  console.log(`  updates touching our candidate set: ${tracked.length}/${updates.length}`);
}
