/**
 * Phase 0 / §0.4 - Pyth equity feed coverage, market-hours and staleness semantics.
 *
 * The spec requires "no price" to be a first-class state rather than an error.
 * This probes Hermes for every underlying in the candidate set and reports which
 * feed variants exist, what each says about market hours right now, and how old
 * the last published price actually is.
 */
import fs from 'node:fs';
import { Connection, PublicKey } from '@solana/web3.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'mints.json'), 'utf8'));
const HERMES = 'https://hermes.pyth.network';

const iso = (s) => (s ? new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : 'n/a');
const nowSec = Math.floor(Date.now() / 1000);

async function feedsFor(symbol) {
  const res = await fetch(`${HERMES}/v2/price_feeds?query=${encodeURIComponent(symbol)}&asset_type=equity`);
  if (!res.ok) return [];
  const all = await res.json();
  // Hermes substring-matches, so "AAPL" also returns unrelated tickers.
  return all.filter((f) => {
    const a = f.attributes ?? {};
    return a.display_symbol === symbol || a.nasdaq_symbol === symbol || a.display_symbol === `PYTH ${symbol}`;
  });
}

/**
 * Hermes' price routes now return 401 without credentials (verified against the
 * always-on BTC feed, so it is an auth gate and not a market-hours signal). Read
 * the sponsored on-chain price accounts instead - which is what the programs
 * have to do anyway.
 *
 * Sponsored feed accounts are PDAs of the PUSH ORACLE program (not the receiver)
 * seeded by [shard_id: u16 LE, feed_id: [u8; 32]].
 *
 * PriceUpdateV2: disc(8) write_authority(32) verification_level(1) then
 * PriceFeedMessage { feed_id(32) price(i64) conf(u64) expo(i32)
 *                    publish_time(i64) prev_publish_time(i64) ... }
 */
const PUSH_ORACLE = new PublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT');

async function onChain(conn, feedIdHex) {
  const id = Buffer.from(feedIdHex, 'hex');
  for (const shard of [0, 1, 2, 3]) {
    const seed = Buffer.alloc(2);
    seed.writeUInt16LE(shard);
    const [pda] = PublicKey.findProgramAddressSync([seed, id], PUSH_ORACLE);
    const info = await conn.getAccountInfo(pda, 'confirmed');
    if (!info) continue;
    const d = info.data;
    let o = 8 + 32 + 1 + 32;
    const price = d.readBigInt64LE(o); o += 8;
    const conf = d.readBigUInt64LE(o); o += 8;
    const expo = d.readInt32LE(o); o += 4;
    const publishTime = Number(d.readBigInt64LE(o)); o += 8;
    const prevPublishTime = Number(d.readBigInt64LE(o));
    return {
      pda: pda.toBase58(), shard,
      price: Number(price) * 10 ** expo,
      conf: Number(conf) * 10 ** expo,
      publishTime, prevPublishTime,
    };
  }
  return null;
}

async function hermesAuthProbe() {
  // Control: BTC/USD is always on. A 401 here proves the gate is auth, not hours.
  const BTC = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
  const res = await fetch(`${HERMES}/v2/updates/price/latest?ids[]=${BTC}&parsed=true`);
  return { status: res.status, ok: res.ok };
}

const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
const symbols = Object.keys(cfg.underlyings);
console.log(`Pyth equity coverage probe - ${new Date().toISOString()}\n`);

const auth = await hermesAuthProbe();
console.log(`Hermes price route, BTC control feed: HTTP ${auth.status}` +
  (auth.ok ? ' (open)' : ' - CREDENTIALS REQUIRED; this is an auth gate, not market hours'));
console.log();

const summary = [];
for (const sym of symbols) {
  const feeds = await feedsFor(sym);
  console.log('='.repeat(88));
  console.log(`${sym}   ${feeds.length} matching equity feed(s)`);
  if (!feeds.length) {
    console.log('  NO FEED - this underlying cannot carry a NAV-banded order or a basis series.');
    summary.push({ sym, feeds: 0, has247: false, open: null, ageSec: null });
    continue;
  }
  let has247 = false, anyOpen = false, bestAge = null;
  for (const f of feeds) {
    const a = f.attributes ?? {};
    const mh = f.market_hours ?? {};
    const is247 = /24\/7/.test(a.description ?? '');
    if (is247) has247 = true;
    if (mh.is_open) anyOpen = true;

    console.log(`  ${a.symbol}`);
    console.log(`    id            ${f.id}`);
    console.log(`    description   ${a.description}`);
    console.log(`    schedule      ${a.schedule}`);
    console.log(`    market open   ${mh.is_open}   next_open ${iso(mh.next_open)}   next_close ${iso(mh.next_close)}`);

    const oc = await onChain(conn, f.id);
    if (!oc) {
      console.log('    on-chain      NO sponsored price account (shards 0-3)');
      console.log('    => unusable on-chain without running our own price pusher');
      continue;
    }
    const ageSec = nowSec - oc.publishTime;
    if (bestAge === null || ageSec < bestAge) bestAge = ageSec;
    console.log(`    on-chain      ${oc.pda} (shard ${oc.shard})`);
    console.log(`    price         ${oc.price.toFixed(4)}  conf ±${oc.conf.toFixed(4)} (${((oc.conf / oc.price) * 10000).toFixed(1)} bps)`);
    console.log(`    publish_time  ${iso(oc.publishTime)}  (prev ${iso(oc.prevPublishTime)})`);
    console.log(`    age           ${(ageSec / 3600).toFixed(2)}h  ${(ageSec / 86400).toFixed(1)} days`);
    console.log(`    => ${ageSec > 86400 ? 'ABANDONED: nobody is pushing this feed on-chain' : ageSec > 60 ? 'stale (market closed or slow publisher)' : 'fresh'}`);
  }
  summary.push({ sym, feeds: feeds.length, has247, open: anyOpen, ageSec: bestAge });
}

console.log('\n' + '='.repeat(88));
console.log('SUMMARY');
console.log(`${'sym'.padEnd(8)} ${'feeds'.padEnd(6)} ${'24/7 variant'.padEnd(14)} ${'open now'.padEnd(10)} freshest age`);
for (const s of summary) {
  console.log(`${s.sym.padEnd(8)} ${String(s.feeds).padEnd(6)} ${String(s.has247).padEnd(14)} ${String(s.open).padEnd(10)} ${s.ageSec === null ? 'n/a' : (s.ageSec / 3600).toFixed(2) + 'h'}`);
}
console.log('\nKey semantics for the pricing service:');
console.log(' 1. Hermes price routes are credentialed. Metadata (/v2/price_feeds) is open.');
console.log(' 2. Sponsored on-chain equity feeds exist but are not maintained - a stale');
console.log('    account still reads as a well-formed price, never as an error. Staleness');
console.log('    must be computed from publish_time; it is never signalled for us.');
console.log(' 3. Some feeds have no on-chain account at all. "No price" is therefore a');
console.log('    first-class state in three distinct flavours: absent, stale, closed.');
