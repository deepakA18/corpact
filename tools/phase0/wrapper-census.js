/**
 * Phase 0 premise test - is there actually a fragmented market to consolidate?
 *
 * The whole product rests on §1's claim that the same company exists as several
 * competing tokens with meaningful liquidity in each. That is an empirical
 * claim and it is cheap to check, so check it before building an N-asset AMM.
 *
 * For each ticker, find every wrapper across the three issuer naming schemes and
 * report market cap and pool liquidity per wrapper. The number that matters is
 * the share of liquidity sitting OUTSIDE the deepest wrapper: that is the
 * liquidity Parity would consolidate. If it is near zero, the market is already
 * consolidated and Tier 1 solves a problem nobody has.
 */
const SEARCH = 'https://lite-api.jup.ag/tokens/v2/search';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TICKERS = (process.env.TICKERS ??
  'NVDA,AAPL,TSLA,MSFT,GOOGL,AMZN,META,COIN,HOOD,MSTR,CRCL,SPY,QQQ,AMD,PLTR,NFLX,SPCX,AVGO'
).split(',');

// Authoritative issuer keys observed in finding 0.1. Symbol and name are
// imitable; the mint authority is not, so identity is decided on that alone.
const ISSUER_BY_MINT_AUTHORITY = {
  '7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj': 'xStocks',
  '9foMHsSDq7nMg4WPusSz9eY7tyxyukqborA8GyU5cUxD': 'Ondo',
  HK6jF79duLLLfCMRQFBSgo6CgQ5mF4tFMFU7CmKcXctZ: 'Backpack',
};

async function search(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${SEARCH}?query=${encodeURIComponent(query)}`);
    if (res.ok) return res.json();
    await sleep(500 * (attempt + 1));
  }
  return [];
}

const usd = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${Math.round(n)}`);

const rows = [];
for (const t of TICKERS) {
  const found = new Map();
  for (const q of [`${t}x`, `${t}on`, t]) {
    for (const tok of await search(q)) {
      const issuer = ISSUER_BY_MINT_AUTHORITY[tok.mintAuthority];
      if (!issuer) continue; // impostor, or an issuer we have not vetted
      // Jupiter's search is fuzzy: querying "PLTR" also returns METAon. Require
      // the symbol to be this ticker under one of the three naming schemes, or
      // unrelated wrappers get attributed to the wrong underlying.
      const sym = (tok.symbol ?? '').toUpperCase();
      if (![`${t}X`, `${t}ON`, t].includes(sym)) continue;
      found.set(tok.id, {
        issuer,
        symbol: tok.symbol,
        mint: tok.id,
        mcap: tok.mcap ?? 0,
        liq: tok.liquidity ?? 0,
        holders: tok.holderCount ?? 0,
        vol24h: (tok.stats24h?.buyVolume ?? 0) + (tok.stats24h?.sellVolume ?? 0),
      });
    }
    await sleep(200);
  }
  const wrappers = [...found.values()].sort((a, b) => b.liq - a.liq);
  if (!wrappers.length) continue;

  const totalLiq = wrappers.reduce((s, w) => s + w.liq, 0);
  const outsideDeepest = totalLiq - (wrappers[0]?.liq ?? 0);
  rows.push({ ticker: t, wrappers, totalLiq, outsideDeepest });

  console.log('='.repeat(84));
  console.log(`${t}   ${wrappers.length} vetted wrapper(s)   total pool liquidity ${usd(totalLiq)}`);
  for (const w of wrappers) {
    const share = totalLiq > 0 ? ((w.liq / totalLiq) * 100).toFixed(1) : '0.0';
    console.log(`  ${w.issuer.padEnd(9)} ${w.symbol.padEnd(9)} mcap ${usd(w.mcap).padStart(8)}  liq ${usd(w.liq).padStart(8)} (${share.padStart(5)}%)  24h vol ${usd(w.vol24h).padStart(8)}  ${String(w.holders).padStart(6)} holders`);
  }
  console.log(`  consolidatable (liquidity outside the deepest wrapper): ${usd(outsideDeepest)}`);
}

console.log('\n' + '='.repeat(84));
console.log('PREMISE TEST - liquidity Parity would actually consolidate\n');
console.log(`${'ticker'.padEnd(8)} ${'wrappers'.padEnd(9)} ${'total liq'.padEnd(11)} ${'deepest share'.padEnd(15)} consolidatable`);
rows.sort((a, b) => b.outsideDeepest - a.outsideDeepest);
for (const r of rows) {
  const share = r.totalLiq > 0 ? ((r.wrappers[0].liq / r.totalLiq) * 100).toFixed(1) + '%' : 'n/a';
  console.log(`${r.ticker.padEnd(8)} ${String(r.wrappers.length).padEnd(9)} ${usd(r.totalLiq).padEnd(11)} ${`${share} (${r.wrappers[0].issuer})`.padEnd(15)} ${usd(r.outsideDeepest)}`);
}
const grandTotal = rows.reduce((s, r) => s + r.totalLiq, 0);
const grandOutside = rows.reduce((s, r) => s + r.outsideDeepest, 0);
console.log(`\nAcross ${rows.length} underlyings: ${usd(grandTotal)} total, ${usd(grandOutside)} outside the deepest wrapper ` +
  `(${grandTotal > 0 ? ((grandOutside / grandTotal) * 100).toFixed(1) : 0}%).`);
console.log('That percentage IS the addressable consolidation, and it is the honest');
console.log('upper bound on what Tier 1 can deliver in depth terms today.');
