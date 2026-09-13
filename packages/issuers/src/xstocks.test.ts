import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IssuerFetchError, createXStocksClient, parseCorporateActions, parseMultiplierHistory } from './xstocks';

const FIXTURES = join(import.meta.dirname, '../../../fixtures/xstocks');

describe('xStocks record parsing', () => {
  it('accepts every recorded corporate action and multiplier-history row', () => {
    for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))) {
      const f = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
      expect(parseCorporateActions(f.corporateActions).rejected, file).toEqual([]);
      expect(parseMultiplierHistory(f.multiplierHistory).rejected, file).toEqual([]);
    }
  });

  it('keeps exact decimal strings and maps timestamps', () => {
    const f = JSON.parse(readFileSync(join(FIXTURES, 'SPYx.json'), 'utf8'));
    const { actions } = parseCorporateActions(f.corporateActions);
    const june = actions.find((a) => a.eventId === 'aeb368f9-101e-44ae-b77a-305d11b5237e');
    expect(june).toMatchObject({
      symbol: 'SPYx',
      type: 'CashDividend',
      status: 'Initial',
      multiplierNew: '1.005714560286254',
      netCashUsdPerShare: '1.3324612',
      withholdingTaxRate: '0.3',
    });
    expect(june?.effectiveAt?.toISOString()).toBe('2026-06-18T04:00:00.000Z');
  });

  it('rejects a malformed row without discarding the rest', () => {
    const f = JSON.parse(readFileSync(join(FIXTURES, 'SPYx.json'), 'utf8'));
    const bad = { ...f.corporateActions[0], netCashflowUsd: '1e-3', caType: 'Dividend' };
    const { actions, rejected } = parseCorporateActions([bad, f.corporateActions[1]]);
    expect(actions).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.issues).toMatch(/caType|netCashflowUsd/);
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('xStocks client', () => {
  it('pages assets from 0 and keeps only Solana deployments, by mint', async () => {
    const seen: string[] = [];
    const client = createXStocksClient({
      baseUrl: 'https://x',
      fetch: async (input) => {
        const url = String(input);
        seen.push(url);
        const page = Number(new URL(url).searchParams.get('page'));
        const asset = (symbol: string, network: string) => ({
          symbol,
          name: symbol,
          underlyingSymbol: null,
          isTradingHalted: false,
          deployments: [{ address: `${symbol}-mint`, network }],
        });
        return json({
          nodes: page === 0 ? [asset('AAx', 'Solana'), asset('EVMx', 'Ethereum')] : [asset('BBx', 'Solana')],
          page: { currentPage: page, hasNextPage: page === 0 },
        });
      },
    });
    const assets = await client.listSolanaAssets();
    expect(assets.map((a) => a.mint)).toEqual(['AAx-mint', 'BBx-mint']);
    expect(seen).toEqual(['https://x/public/assets?page=0', 'https://x/public/assets?page=1']);
  });

  it('pages corporate actions from 1', async () => {
    const pages: number[] = [];
    const client = createXStocksClient({
      baseUrl: 'https://x',
      fetch: async (input) => {
        const page = Number(new URL(String(input)).searchParams.get('page'));
        pages.push(page);
        return json({ nodes: [], page: { currentPage: page, hasNextPage: page < 2 } });
      },
    });
    await client.corporateActions('history', { symbol: 'SPYx' });
    expect(pages).toEqual([1, 2]);
  });

  it('distinguishes "could not fetch" from "no data"', async () => {
    const down = createXStocksClient({ fetch: async () => { throw new TypeError('socket hang up'); } });
    await expect(down.latestPriceScaled('SPYx')).rejects.toMatchObject({ name: 'IssuerFetchError', status: null });

    const limited = createXStocksClient({ fetch: async () => json({}, 429) });
    await expect(limited.latestPriceScaled('SPYx')).rejects.toBeInstanceOf(IssuerFetchError);

    const reshaped = createXStocksClient({ fetch: async () => json({ price: 1 }) });
    await expect(reshaped.latestPriceScaled('SPYx')).rejects.toThrow(/Unexpected response shape/);
  });

  it('reads the price exactly as published', async () => {
    const client = createXStocksClient({ fetch: async () => json({ quote: 764.415 }) });
    expect((await client.latestPriceScaled('SPYx')).toString()).toBe('152883/200');
  });
});
