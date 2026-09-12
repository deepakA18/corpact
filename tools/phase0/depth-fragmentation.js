/**
 * Phase 0 supplement - baseline for §12 success metric #1.
 *
 * "Depth at 100bps for pTICKER/USDC versus the sum of depth at 100bps across
 *  all individual wrapper pairs. If the consolidated book is not deeper than
 *  the fragmented ones, the core thesis is wrong."
 *
 * We cannot measure the consolidated side before it exists, but we can measure
 * the fragmented side now, and that number is the bar Parity has to clear. It
 * is also the honest way to find out whether the thesis is worth building
 * against BEFORE writing an N-asset AMM.
 *
 * Depth is measured the way a user experiences it: binary-search the USDC size
 * whose routed quote incurs a given price impact. That captures real routable
 * liquidity across every venue rather than headline TVL, which overstates
 * concentrated liquidity sitting outside the traded range.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'mints.json'), 'utf8'));
const USDC = cfg.reference.USDC;
const QUOTE = 'https://lite-api.jup.ag/swap/v1/quote';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS_BPS = [100, 300, 1000];
const MAX_USDC = 2_000_000;
const MIN_USDC = 100;

/**
 * Returns {impactBps} on success, NO_ROUTE when the aggregator genuinely has no
 * path, or THROTTLED when we ran out of retries.
 *
 * The distinction is the whole point: an early version collapsed both into null,
 * and a rate-limited run silently reported $661k of real SPCX liquidity as "no
 * route". A throttled probe must poison the measurement, never zero it.
 */
const NO_ROUTE = Symbol('no-route');
const THROTTLED = Symbol('throttled');

async function quote(outputMint, usdc) {
  const amount = Math.round(usdc * 1e6);
  const url = `${QUOTE}?inputMint=${USDC}&outputMint=${outputMint}&amount=${amount}&slippageBps=5000`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url);
    const body = await res.text().catch(() => '');
    if (res.ok) {
      let q;
      try { q = JSON.parse(body); } catch { return THROTTLED; }
      if (!q.outAmount) return NO_ROUTE;
      return { impactBps: Math.abs(Number(q.priceImpactPct ?? 0)) * 10000 };
    }
    if (res.status === 429 || /rate limit/i.test(body)) {
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    if (/NO_ROUTES_FOUND/.test(body)) return NO_ROUTE;
    process.stderr.write(`  quote ${res.status}: ${body.slice(0, 160)}\n`);
    return THROTTLED;
  }
  return THROTTLED;
}

/** Largest USDC notional whose routed price impact stays within targetBps. */
async function depthAt(outputMint, targetBps) {
  const top = await quote(outputMint, MAX_USDC);
  if (top === THROTTLED) return { unknown: true };
  if (top !== NO_ROUTE && top.impactBps <= targetBps) return { usdc: MAX_USDC, capped: true };

  const probe = await quote(outputMint, MIN_USDC);
  if (probe === THROTTLED) return { unknown: true };
  if (probe === NO_ROUTE) return { usdc: 0, dead: true };
  if (probe.impactBps > targetBps) return { usdc: 0 };

  let lo = MIN_USDC, hi = MAX_USDC;
  for (let i = 0; i < 13; i++) {
    const mid = Math.sqrt(lo * hi); // geometric bisection: depth spans orders of magnitude
    const q = await quote(outputMint, mid);
    await sleep(Number(process.env.QUOTE_DELAY_MS ?? 400));
    if (q === THROTTLED) return { unknown: true };
    if (q !== NO_ROUTE && q.impactBps <= targetBps) lo = mid; else hi = mid;
  }
  return { usdc: lo };
}

const usd = (n) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
console.log(`Routable depth into USDC pairs - ${new Date().toISOString()}`);
console.log('US equity market is CLOSED at this timestamp; these are off-hours books.\n');

const only = process.env.TICKERS ? new Set(process.env.TICKERS.split(',')) : null;
const results = {};
for (const [underlying, entries] of Object.entries(cfg.underlyings)) {
  if (only && !only.has(underlying)) continue;
  console.log('='.repeat(80));
  console.log(`${underlying}`);
  console.log(`  ${'wrapper'.padEnd(10)} ${TARGETS_BPS.map((b) => `depth@${b}bps`.padStart(13)).join('')}`);
  const perWrapper = [];
  for (const e of entries) {
    const row = [];
    for (const t of TARGETS_BPS) {
      const d = await depthAt(e.mint, t);
      row.push(d);
      await sleep(Number(process.env.QUOTE_DELAY_MS ?? 400));
    }
    perWrapper.push({ symbol: e.symbol, row });
    const cells = row.map((d) => (d.unknown ? 'THROTTLED' : d.dead ? 'no route' : d.capped ? `>${usd(MAX_USDC)}` : usd(d.usdc)).padStart(13)).join('');
    console.log(`  ${e.symbol.padEnd(10)}${cells}`);
  }
  const sums = TARGETS_BPS.map((_, i) => perWrapper.reduce((s, w) => s + (w.row[i].usdc ?? 0), 0));
  const incomplete = perWrapper.some((w) => w.row.some((d) => d.unknown));
  console.log(`  ${'FRAGMENTED'.padEnd(10)}${sums.map((s) => usd(s).padStart(13)).join('')}   <- sum of separate books` +
    (incomplete ? '  (INCOMPLETE: a probe was throttled)' : ''));
  console.log(`  ${'(bar for'.padEnd(10)}${'p' + underlying + '/USDC to beat)'.padStart(39)}`);
  results[underlying] = { perWrapper, sums };
}

console.log('\n' + '='.repeat(80));
console.log('Interpretation: summing separate books OVERSTATES what a fragmented market');
console.log('delivers to one user - a single order hits one book, not all of them. The');
console.log('realistic comparison for a user is the BEST single wrapper, not the sum.');
console.log('Parity clears the bar if consolidated depth beats the sum; it is already');
console.log('useful to a user if it beats the best single wrapper.\n');
console.log(`${'underlying'.padEnd(12)} ${'best single @100bps'.padEnd(22)} ${'sum @100bps'.padEnd(14)} concentration`);
for (const [u, r] of Object.entries(results)) {
  const at100 = r.perWrapper.map((w) => w.row[0].usdc ?? 0);
  const best = Math.max(...at100, 0);
  const sum = r.sums[0];
  const share = sum > 0 ? ((best / sum) * 100).toFixed(0) + '%' : 'n/a';
  const who = r.perWrapper[at100.indexOf(best)]?.symbol ?? '-';
  console.log(`${u.padEnd(12)} ${`${usd(best)} (${who})`.padEnd(22)} ${usd(sum).padEnd(14)} ${share} in the deepest`);
}
