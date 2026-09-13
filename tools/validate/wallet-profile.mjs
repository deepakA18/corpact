/**
 * §0.1 refinement — of the wallets with material dividend income, how many look
 * like exchanges, market makers or issuer wallets, and how many are plausibly
 * individuals?
 *
 * Program-owned (off-curve) owners are excluded up front, so every wallet here is
 * a plain keypair. Who controls a keypair is not on-chain; the buckets below are
 * behavioural heuristics with stated thresholds, and the raw features are written
 * out so they can be re-bucketed.
 *
 * Dividend events come from the corporate-actions feed (latest version, CashDividend,
 * Initial/Corrected), not the multiplier-history `reason`, which mislabels spin-offs.
 *
 * Inputs:  out/xstocks-solana-history.json, out/ca-history.json
 * Output:  out/wallet-profiles.json (contains wallet addresses — do not commit)
 */
import fs from 'node:fs';
import { PublicKey } from '@solana/web3.js';

const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const T22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SINCE = Date.parse('2025-09-13T00:00:00Z');
const PROFILE_MIN_USD = Number(process.env.PROFILE_MIN_USD ?? 10);

// Bucket thresholds — judgment calls, not facts.
const HOT_WALLET_SPAN_DAYS = 7; // a full 1,000-signature page spanning ≤ 7 days
const BROAD_T22_ACCOUNTS = 40;
const BROAD_DIVIDEND_ASSETS = 25;
const CONCENTRATED_SUPPLY_SHARE = 0.1;
// Token-2022 mint extensions whose payload starts with an authority/delegate key.
const AUTHORITY_EXTENSIONS = new Set([4, 12, 14, 18, 19, 25, 26]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const b58 = (bytes) => new PublicKey(bytes).toBase58();

async function rpc(method, params) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result;
    } catch (err) {
      if (attempt === 10) throw new Error(`${method} failed after 10 attempts: ${err.message}`);
      await sleep(1500 * attempt);
    }
  }
}

async function price(symbol) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`https://api.xstocks.fi/api/v2/public/assets/${symbol}/price-data`).catch(() => null);
    if (res?.ok) return (await res.json()).quote;
    await sleep(1000 * attempt);
  }
  throw new Error(`price for ${symbol} unavailable`);
}

async function pool(items, concurrency, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

// ---- dividend events from corporate actions ---------------------------------
const { assets } = JSON.parse(fs.readFileSync('out/xstocks-solana-history.json', 'utf8'));
const latest = new Map();
for (const c of JSON.parse(fs.readFileSync('out/ca-history.json', 'utf8'))) {
  const seen = latest.get(c.eventId);
  if (!seen || c.version > seen.version) latest.set(c.eventId, c);
}
const cashDividendAt = new Set(
  [...latest.values()]
    .filter((c) => c.caType === 'CashDividend' && (c.status === 'Initial' || c.status === 'Corrected') && c.effectiveTimeUtc)
    .map((c) => `${c.xstockSymbol}|${new Date(c.effectiveTimeUtc).toISOString()}`),
);
const dividendAssets = assets
  .map((a) => ({
    ...a,
    events: a.history.filter(
      (h) => Date.parse(h.activationDateTime) >= SINCE && cashDividendAt.has(`${a.symbol}|${new Date(h.activationDateTime).toISOString()}`),
    ),
  }))
  .filter((a) => a.events.length);
log(`dividend-paying assets (corporate-action CashDividend): ${dividendAssets.length}`);

// ---- mint decimals and issuer authority keys --------------------------------
const decimals = {};
const issuerKeys = new Set();
for (let i = 0; i < dividendAssets.length; i += 100) {
  const batch = dividendAssets.slice(i, i + 100);
  const { value } = await rpc('getMultipleAccounts', [batch.map((a) => a.mint), { encoding: 'base64' }]);
  value.forEach((v, k) => {
    const b = Buffer.from(v.data[0], 'base64');
    decimals[batch[k].mint] = b[44];
    if (b.readUInt32LE(0) === 1) issuerKeys.add(b58(b.subarray(4, 36)));
    if (b.readUInt32LE(46) === 1) issuerKeys.add(b58(b.subarray(50, 82)));
    for (let o = 166; o + 4 <= b.length; ) {
      const type = b.readUInt16LE(o);
      const len = b.readUInt16LE(o + 2);
      if (type === 0 && len === 0) break;
      const key = b.subarray(o + 4, o + 36);
      if (AUTHORITY_EXTENSIONS.has(type) && len >= 32 && key.some((x) => x !== 0)) issuerKeys.add(b58(key));
      o += 4 + len;
    }
  });
}
log(`issuer authority keys named on mints: ${issuerKeys.size}`);

// ---- phase A: holders × income ----------------------------------------------
const owners = new Map(); // hex -> { assets, incomeUsd, positions }
const onCurveSupply = {};
const failed = [];
const onCurve = new Map();
let done = 0;

await pool(dividendAssets, 2, async (a) => {
  try {
    const quote = await price(a.symbol);
    const accounts = await rpc('getProgramAccounts', [
      T22,
      { encoding: 'base64', dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: a.mint } }] },
    ]);
    const deltaM = a.events.reduce((s, e) => s + (e.multiplier - e.previousMultiplier), 0);
    const byOwner = new Map();
    for (const x of accounts) {
      if (x.account.space < 165) continue;
      const b = Buffer.from(x.account.data[0], 'base64');
      const raw = b.readBigUInt64LE(32);
      if (raw === 0n) continue;
      const hex = b.subarray(0, 32).toString('hex');
      byOwner.set(hex, (byOwner.get(hex) ?? 0n) + raw);
    }
    let supply = 0;
    for (const [hex, raw] of byOwner) {
      if (!onCurve.has(hex)) onCurve.set(hex, PublicKey.isOnCurve(Buffer.from(hex, 'hex')));
      if (!onCurve.get(hex)) continue;
      const units = Number(raw) / 10 ** decimals[a.mint];
      supply += units;
      const incomeUsd = units * deltaM * quote;
      const o = owners.get(hex) ?? { assets: 0, incomeUsd: 0, positions: [] };
      o.assets++;
      o.incomeUsd += incomeUsd;
      if (incomeUsd >= 1) o.positions.push({ symbol: a.symbol, units, incomeUsd });
      owners.set(hex, o);
    }
    onCurveSupply[a.symbol] = supply;
  } catch (err) {
    failed.push({ symbol: a.symbol, error: err.message });
  }
  if (++done % 25 === 0) log(`holders: ${done}/${dividendAssets.length}, failed ${failed.length}`);
});
log(`holders done: ${owners.size} on-curve wallets, ${failed.length} assets failed`);

// ---- phase B: profile material wallets --------------------------------------
const candidates = [...owners].filter(([, o]) => o.incomeUsd >= PROFILE_MIN_USD);
const now = Date.now() / 1000;
const profiles = [];
done = 0;

function bucket(p) {
  if (p.issuerKey) return 'issuer_authority';
  if (p.signaturePageFull && p.signaturePageSpanDays <= HOT_WALLET_SPAN_DAYS) return 'high_throughput';
  if (p.token2022Accounts >= BROAD_T22_ACCOUNTS || p.dividendAssets >= BROAD_DIVIDEND_ASSETS) return 'broad_book';
  if (p.maxSupplyShare >= CONCENTRATED_SUPPLY_SHARE) return 'concentrated_holder';
  return 'plausibly_individual';
}

await pool(candidates, 3, async ([hex, o]) => {
  const address = b58(Buffer.from(hex, 'hex'));
  try {
    const slice = { encoding: 'base64', dataSlice: { offset: 0, length: 0 } };
    const [account, t22, spl, sigs] = await Promise.all([
      rpc('getAccountInfo', [address, slice]),
      rpc('getTokenAccountsByOwner', [address, { programId: T22 }, slice]),
      rpc('getTokenAccountsByOwner', [address, { programId: SPL }, slice]),
      rpc('getSignaturesForAddress', [address, { limit: 1000 }]),
    ]);
    const times = sigs.map((s) => s.blockTime).filter((t) => t != null);
    const positions = o.positions
      .map((p) => ({ ...p, supplyShare: onCurveSupply[p.symbol] ? p.units / onCurveSupply[p.symbol] : null }))
      .sort((x, y) => y.incomeUsd - x.incomeUsd);
    const profile = {
      address,
      incomeUsd: o.incomeUsd,
      dividendAssets: o.assets,
      topPositions: positions.slice(0, 5),
      maxSupplyShare: Math.max(0, ...positions.map((p) => p.supplyShare ?? 0)),
      lamports: account.value?.lamports ?? 0,
      accountOwner: account.value?.owner ?? null,
      token2022Accounts: t22.value.length,
      splTokenAccounts: spl.value.length,
      signatures: sigs.length,
      signaturePageFull: sigs.length === 1000,
      signaturePageSpanDays: times.length ? (Math.max(...times) - Math.min(...times)) / 86400 : null,
      signaturesLast7d: times.filter((t) => t >= now - 7 * 86400).length,
      issuerKey: issuerKeys.has(address),
    };
    profile.bucket = bucket(profile);
    profiles.push(profile);
  } catch (err) {
    profiles.push({ address, incomeUsd: o.incomeUsd, dividendAssets: o.assets, bucket: 'profile_failed', error: err.message });
  }
  if (++done % 100 === 0) log(`profiles: ${done}/${candidates.length}`);
});

// ---- summary -----------------------------------------------------------------
const tiers = [10, 100, 1000, 10000];
const summary = {
  computedAt: new Date().toISOString(),
  thresholds: { PROFILE_MIN_USD, HOT_WALLET_SPAN_DAYS, BROAD_T22_ACCOUNTS, BROAD_DIVIDEND_ASSETS, CONCENTRATED_SUPPLY_SHARE },
  dividendAssets: dividendAssets.length,
  failedAssets: failed,
  onCurveWallets: owners.size,
  tiers: Object.fromEntries(
    tiers.map((min) => {
      const inTier = profiles.filter((p) => p.incomeUsd >= min);
      const byBucket = {};
      for (const p of inTier) {
        const b = (byBucket[p.bucket] ??= { wallets: 0, incomeUsd: 0 });
        b.wallets++;
        b.incomeUsd = Math.round(b.incomeUsd + p.incomeUsd);
      }
      return [`>=$${min}`, { wallets: inTier.length, incomeUsd: Math.round(inTier.reduce((s, p) => s + p.incomeUsd, 0)), byBucket }];
    }),
  ),
};
fs.writeFileSync('out/wallet-profiles.json', JSON.stringify({ summary, profiles: profiles.sort((a, b) => b.incomeUsd - a.incomeUsd) }, null, 1));
console.log(JSON.stringify(summary, null, 1));
