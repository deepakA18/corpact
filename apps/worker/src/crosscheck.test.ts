import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeToken2022Mint, type TokenAccountSnapshot } from '@corpact/solana';
import type { Context } from './context';
import { compareMintStates, compareTokenBalances, crossCheckBalances, recordProviderCheck } from './crosscheck';

const KOX = 'XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ';
const OTHER_MINT = 'So11111111111111111111111111111111111111112';
const OWNER = '6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U';
const ALLOWED = new Set([KOX]);

const account = (address: string, amount: bigint, mint = KOX) =>
  ({ address, mint, owner: OWNER, amount, tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }) as unknown as TokenAccountSnapshot;

describe('compareTokenBalances', () => {
  it('matches identical allowlisted balances and ignores other mints', () => {
    expect(compareTokenBalances([account('A', 5n), account('B', 1n, OTHER_MINT)], [account('A', 5n), account('B', 9n, OTHER_MINT)], ALLOWED)).toEqual([]);
  });

  it('reports a changed balance, and an account missing on one side unless it is empty', () => {
    expect(compareTokenBalances([account('A', 5n), account('Z', 0n)], [account('A', 6n)], ALLOWED)).toEqual([
      { account: 'A', mint: KOX, primaryRaw: '5', secondaryRaw: '6' },
    ]);
    expect(compareTokenBalances([account('A', 5n)], [], ALLOWED)).toEqual([{ account: 'A', mint: KOX, primaryRaw: '5', secondaryRaw: null }]);
  });
});

describe('compareMintStates on a recorded mainnet mint', () => {
  const recorded = JSON.parse(readFileSync(join(import.meta.dirname, '../../../fixtures/chain/mint-SPYx.json'), 'utf8'));
  const data = new Uint8Array(Buffer.from(recorded.value.data[0], 'base64'));
  const owner = recorded.value.owner as string;
  const mint = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W';

  it('agrees on identical bytes', () => {
    const accounts = new Map([[mint, { owner, data }]]);
    expect(compareMintStates(accounts, new Map([[mint, { owner, data: data.slice() }]]), [mint])).toEqual([]);
  });

  it('names the field when one provider reports a different pending multiplier', () => {
    const bits = Buffer.from(decodeToken2022Mint(data).scaledUiAmount!.newMultiplierBits, 'hex');
    const tampered = Buffer.from(data);
    const offset = [tampered.indexOf(bits), tampered.indexOf(Buffer.from(bits).reverse())].find((i) => i >= 0)!;
    expect(offset).toBeGreaterThan(0);
    tampered[offset + 3] = tampered[offset + 3]! ^ 1;
    const differences = compareMintStates(new Map([[mint, { owner, data }]]), new Map([[mint, { owner, data: new Uint8Array(tampered) }]]), [mint]);
    expect(differences.map((d) => d.field)).toEqual(['newMultiplier']);
  });

  it('reports a mint one provider does not have', () => {
    const differences = compareMintStates(new Map([[mint, { owner, data }]]), new Map(), [mint]);
    expect(differences.map((d) => d.field)).toContain('account');
  });
});

function fakeContext(options: {
  primary: (minContextSlot?: bigint) => { slot: bigint; accounts: TokenAccountSnapshot[] };
  secondary: (minContextSlot?: bigint) => { slot: bigint; accounts: TokenAccountSnapshot[] };
  previous?: { outcome: string; age: number };
}) {
  const inserted: unknown[][] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT outcome')) return { rows: options.previous ? [options.previous] : [], rowCount: options.previous ? 1 : 0 };
      if (sql.includes('INSERT INTO provider_checks')) {
        inserted.push(params);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const reader = (url: string, read: typeof options.primary) => ({
    rpcUrl: url,
    tokenAccountsByOwner: async (_owner: string, _program: string, o: { minContextSlot?: bigint } = {}) => read(o.minContextSlot),
  });
  const ctx = {
    db,
    chain: reader('https://primary.example/rpc?api-key=never-stored', options.primary),
    reconciler: reader('https://secondary.example', options.secondary),
    log: () => {},
  } as unknown as Context;
  return { ctx, inserted };
}

describe('crossCheckBalances', () => {
  const snapshot = { slot: 100n, accounts: [account('A', 5n)] };

  it('records agreement with provider hosts only, never the URL and its key', async () => {
    const { ctx, inserted } = fakeContext({ primary: () => snapshot, secondary: () => ({ slot: 100n, accounts: [account('A', 5n)] }) });
    expect(await crossCheckBalances(ctx, OWNER, snapshot, ALLOWED)).toEqual({ outcome: 'agree', differences: [] });
    expect(inserted[0]!.slice(0, 7)).toEqual(['token_balances', OWNER, 'primary.example', 'secondary.example', '100', '100', 'agree']);
  });

  it('re-reads the primary at the secondary slot before calling a difference a disagreement', async () => {
    const { ctx, inserted } = fakeContext({
      primary: (min) => (min === 105n ? { slot: 105n, accounts: [account('A', 7n)] } : snapshot),
      secondary: () => ({ slot: 105n, accounts: [account('A', 7n)] }),
    });
    expect((await crossCheckBalances(ctx, OWNER, snapshot, ALLOWED))?.outcome).toBe('agree');
    expect(inserted[0]![4]).toBe('105');
  });

  it('disagrees when the primary reports an unchanged balance on both sides of the secondary slot', async () => {
    const { ctx } = fakeContext({
      primary: (min) => (min === 105n ? { slot: 110n, accounts: [account('A', 5n)] } : snapshot),
      secondary: () => ({ slot: 105n, accounts: [account('A', 6n)] }),
    });
    expect((await crossCheckBalances(ctx, OWNER, snapshot, ALLOWED))?.outcome).toBe('disagree');
  });

  it('is inconclusive when the balance moved around the secondary slot', async () => {
    const { ctx } = fakeContext({
      primary: (min) => (min === 105n ? { slot: 110n, accounts: [account('A', 7n)] } : snapshot),
      secondary: () => ({ slot: 105n, accounts: [account('A', 6n)] }),
    });
    expect((await crossCheckBalances(ctx, OWNER, snapshot, ALLOWED))?.outcome).toBe('inconclusive');
  });

  it('disagrees when both providers answer for the same slot with different balances', async () => {
    const { ctx, inserted } = fakeContext({ primary: () => snapshot, secondary: () => ({ slot: 100n, accounts: [account('A', 4n)] }) });
    const result = await crossCheckBalances(ctx, OWNER, snapshot, ALLOWED);
    expect(result).toMatchObject({ outcome: 'disagree', differences: [{ account: 'A', primaryRaw: '5', secondaryRaw: '4' }] });
    expect(inserted[0]![6]).toBe('disagree');
  });

  it('is inconclusive, not an error, when the independent provider fails', async () => {
    const { ctx, inserted } = fakeContext({
      primary: () => snapshot,
      secondary: () => {
        throw new Error('getTokenAccountsByOwner: failed after 4 attempts');
      },
    });
    expect((await crossCheckBalances(ctx, OWNER, snapshot, ALLOWED))?.outcome).toBe('inconclusive');
    expect(inserted[0]![6]).toBe('inconclusive');
  });
});

describe('recordProviderCheck', () => {
  const row = { kind: 'mint_state' as const, subject: KOX, primaryHost: 'p', secondaryHost: 's', primarySlot: 1n, secondarySlot: 1n, details: [] };

  it('skips a repeated agreement inside the quiet window but always records a change', async () => {
    const quiet = fakeContext({ primary: () => ({ slot: 1n, accounts: [] }), secondary: () => ({ slot: 1n, accounts: [] }), previous: { outcome: 'agree', age: 60 } });
    expect(await recordProviderCheck(quiet.ctx.db, { ...row, outcome: 'agree' }, 3600)).toBe('agree');
    expect(quiet.inserted).toHaveLength(0);

    const recovered = fakeContext({ primary: () => ({ slot: 1n, accounts: [] }), secondary: () => ({ slot: 1n, accounts: [] }), previous: { outcome: 'disagree', age: 60 } });
    expect(await recordProviderCheck(recovered.ctx.db, { ...row, outcome: 'agree' }, 3600)).toBe('disagree');
    expect(recovered.inserted).toHaveLength(1);
  });
});
