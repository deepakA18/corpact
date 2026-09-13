import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TransactionParseError, parseTransaction, toStorablePayload } from './transaction';

const CHAIN = join(import.meta.dirname, '../../../fixtures/chain');
const KOX = 'XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ';
const recorded = () => JSON.parse(readFileSync(join(CHAIN, 'tx-transfer-KOx.json'), 'utf8'));

describe('parseTransaction on a recorded KOx transaction', () => {
  it('matches every KOx pre/post balance in the raw payload, by raw amount and owner', () => {
    const { result } = recorded();
    const parsed = parseTransaction(result, { mints: new Set([KOX]) });
    expect(parsed.failed).toBe(false);
    expect(parsed.anomalies).toEqual([]);

    const keys = [
      ...result.transaction.message.accountKeys,
      ...(result.meta.loadedAddresses?.writable ?? []),
      ...(result.meta.loadedAddresses?.readonly ?? []),
    ];
    const amount = (list: { accountIndex: number; mint: string; uiTokenAmount: { amount: string } }[], i: number) =>
      BigInt(list.find((b) => b.accountIndex === i && b.mint === KOX)?.uiTokenAmount.amount ?? '0');
    const indices = new Set<number>(
      [...result.meta.preTokenBalances, ...result.meta.postTokenBalances].filter((b) => b.mint === KOX).map((b) => b.accountIndex),
    );
    const expected = [...indices]
      .map((i) => ({ account: keys[i], rawBefore: amount(result.meta.preTokenBalances, i), rawAfter: amount(result.meta.postTokenBalances, i) }))
      .filter((e) => e.rawBefore !== e.rawAfter);

    expect(parsed.balanceChanges.map(({ account, rawBefore, rawAfter }) => ({ account, rawBefore, rawAfter }))).toEqual(
      expect.arrayContaining(expected),
    );
    expect(parsed.balanceChanges.every((c) => c.mint === KOX && c.ownerBefore !== null)).toBe(true);
  });

  it('accepts the payload after bigint-safe storage', () => {
    const { result } = recorded();
    expect(parseTransaction(toStorablePayload(result)).balanceChanges.length).toBeGreaterThan(0);
  });

  it('treats a failed transaction as moving nothing', () => {
    const { result } = recorded();
    const failed = parseTransaction({ ...result, meta: { ...result.meta, err: { InstructionError: [0, 'Custom'] } } });
    expect(failed).toMatchObject({ failed: true, balanceChanges: [], multiplierWrites: [] });
  });

  it('flags an account that vanishes from post balances without CloseAccount, rather than zeroing it silently', () => {
    const { result } = recorded();
    const victim = result.meta.postTokenBalances.find((b: { mint: string }) => b.mint === KOX);
    const tampered = {
      ...result,
      meta: { ...result.meta, postTokenBalances: result.meta.postTokenBalances.filter((b: unknown) => b !== victim) },
    };
    expect(parseTransaction(tampered, { mints: new Set([KOX]) }).anomalies.join()).toMatch(/without a CloseAccount/);
  });

  it('rejects payloads without metadata or block time', () => {
    const { result } = recorded();
    expect(() => parseTransaction({ ...result, meta: null })).toThrow(TransactionParseError);
    expect(() => parseTransaction({ ...result, blockTime: null })).toThrow(/no block time/);
    expect(() => parseTransaction({ nope: true })).toThrow(/Unexpected getTransaction shape/);
  });
});
