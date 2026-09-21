/**
 * Re-record issuer fixtures from the live xStocks API.
 *   node tools/record-fixtures.mjs SPYx HONx ...
 * Defaults to the symbols the accounting tests use. Review the diff before
 * committing: a changed fixture can legitimately change classification results.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.xstocks.fi/api/v2/public';
const OUT = join(import.meta.dirname, '../fixtures/xstocks');
const symbols = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['SPYx', 'HONx', 'KLACx', 'NFLXx', 'NVOx', 'STRCx', 'AZNx', 'NVDAx', 'KOx'];

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function pages(firstPage, urlFor) {
  const nodes = [];
  for (let page = firstPage; ; page++) {
    const body = await getJson(urlFor(page));
    nodes.push(...body.nodes);
    if (!body.page.hasNextPage) return nodes;
  }
}

const recordedAt = new Date().toISOString();
for (const symbol of symbols) {
  const asset = await getJson(`${API}/assets/${symbol}`);
  const mint = asset.deployments.find((d) => d.network === 'Solana')?.address;
  if (!mint) throw new Error(`${symbol} has no Solana deployment`);
  const multiplierHistory = await pages(0, (p) => `${API}/assets/${symbol}/multiplier/history?network=Solana&page=${p}`);
  const corporateActions = await pages(1, (p) => `${API}/corporate-actions/history?symbol=${symbol}&pageSize=100&page=${p}`);
  writeFileSync(
    join(OUT, `${symbol}.json`),
    `${JSON.stringify({ _source: `api.xstocks.fi/api/v2/public - recorded ${recordedAt}`, symbol, mint, multiplierHistory, corporateActions }, null, 1)}\n`,
  );
  console.log(`${symbol} ${mint} history=${multiplierHistory.length} actions=${corporateActions.length}`);
}
