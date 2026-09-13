import { z } from 'zod';
import { address, getBase58Encoder, type Address } from '@solana/kit';
import { readFloat64Bits } from './bytes';
import type { MultiplierWrite } from './timeline';

export const TOKEN_2022_PROGRAM: Address = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const TOKEN_PROGRAM: Address = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// Token program instruction discriminators (shared by Token and Token-2022).
const IX_TRANSFER = 3;
const IX_SET_AUTHORITY = 6;
const IX_MINT_TO = 7;
const IX_BURN = 8;
const IX_CLOSE_ACCOUNT = 9;
const IX_TRANSFER_CHECKED = 12;
const IX_MINT_TO_CHECKED = 14;
const IX_BURN_CHECKED = 15;
const AUTHORITY_TYPE_ACCOUNT_OWNER = 2;
// Token-2022 ScaledUiAmount extension instructions.
const IX_SCALED_UI_AMOUNT = 43;
const SCALED_UI_INITIALIZE = 0;
const SCALED_UI_UPDATE_MULTIPLIER = 1;

export class TransactionParseError extends Error {
  override name = 'TransactionParseError';
}

// RPC responses are untrusted. Numbers may arrive as number, bigint (kit) or string (stored payloads).
const integer = z.union([z.bigint(), z.number().int(), z.string().regex(/^-?\d+$/)]).transform((v) => BigInt(v));
const index = z.union([z.number().int(), z.bigint()]).transform((v) => Number(v)).pipe(z.number().int().nonnegative());
const compiledInstruction = z.object({
  programIdIndex: index,
  accounts: z.array(index),
  data: z.string(),
});
const tokenBalance = z.object({
  accountIndex: index,
  mint: z.string(),
  owner: z.string().optional(),
  programId: z.string().optional(),
  uiTokenAmount: z.object({ amount: z.string().regex(/^\d+$/) }),
});
const transactionSchema = z.object({
  slot: integer,
  blockTime: integer.nullable(),
  transaction: z.object({
    signatures: z.array(z.string()).min(1),
    message: z.object({ accountKeys: z.array(z.string()), instructions: z.array(compiledInstruction) }),
  }),
  meta: z
    .object({
      err: z.unknown().nullable(),
      innerInstructions: z.array(z.object({ index, instructions: z.array(compiledInstruction) })).nullish(),
      loadedAddresses: z.object({ writable: z.array(z.string()), readonly: z.array(z.string()) }).nullish(),
      preTokenBalances: z.array(tokenBalance).nullish(),
      postTokenBalances: z.array(tokenBalance).nullish(),
    })
    .nullable(),
});

export type MovementReason = 'mint' | 'burn' | 'transfer' | 'open' | 'close' | 'owner_change';

export interface TokenBalanceChange {
  account: Address;
  mint: Address;
  tokenProgram: Address | null;
  ownerBefore: Address | null;
  ownerAfter: Address | null;
  rawBefore: bigint;
  rawAfter: bigint;
  reason: MovementReason;
}

export interface ParsedTransaction {
  signature: string;
  slot: bigint;
  blockTime: bigint;
  failed: boolean;
  balanceChanges: TokenBalanceChange[];
  multiplierWrites: MultiplierWrite[];
  /** Anything that prevents treating this transaction as complete evidence. Never silently zeroed. */
  anomalies: string[];
}

const base58 = getBase58Encoder();

/**
 * Decode a `getTransaction` (encoding "json") result: token balance changes from
 * pre/post balances (which cover inner instructions and lookup-table accounts) and
 * ScaledUiAmount writes from top-level and inner instructions.
 */
export function parseTransaction(raw: unknown, options: { mints?: ReadonlySet<string> } = {}): ParsedTransaction {
  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success) throw new TransactionParseError(`Unexpected getTransaction shape: ${z.prettifyError(parsed.error)}`);
  const tx = parsed.data;
  const signature = tx.transaction.signatures[0]!;
  if (tx.meta === null) throw new TransactionParseError(`${signature}: transaction has no status metadata`);
  if (tx.blockTime === null) throw new TransactionParseError(`${signature}: no block time; cannot order against multiplier activation`);
  const { meta } = tx;
  const blockTime = tx.blockTime;
  const inScope = (mint: string) => options.mints === undefined || options.mints.has(mint);

  if (meta.err !== null) {
    // A failed transaction moves no tokens and writes no extension state.
    return { signature, slot: tx.slot, blockTime, failed: true, balanceChanges: [], multiplierWrites: [], anomalies: [] };
  }

  const keys = [
    ...tx.transaction.message.accountKeys,
    ...(meta.loadedAddresses?.writable ?? []),
    ...(meta.loadedAddresses?.readonly ?? []),
  ];
  const key = (i: number): Address => {
    const k = keys[i];
    if (k === undefined) throw new TransactionParseError(`${signature}: account index ${i} is outside ${keys.length} keys`);
    return k as Address;
  };

  const instructions = [
    ...tx.transaction.message.instructions.map((ix, i) => ({ path: [i], ix })),
    ...(meta.innerInstructions ?? []).flatMap((group) => group.instructions.map((ix, j) => ({ path: [group.index, j], ix }))),
  ];

  const anomalies: string[] = [];
  const multiplierWrites: MultiplierWrite[] = [];
  const minted = new Set<string>();
  const burned = new Set<string>();
  const closed = new Set<string>();

  for (const { path, ix } of instructions) {
    const program = key(ix.programIdIndex);
    if (program !== TOKEN_2022_PROGRAM && program !== TOKEN_PROGRAM) continue;
    const data = new Uint8Array(base58.encode(ix.data));
    const accounts = ix.accounts.map(key);
    switch (data[0]) {
      case IX_MINT_TO:
      case IX_MINT_TO_CHECKED:
        if (accounts[1]) minted.add(accounts[1]);
        break;
      case IX_BURN:
      case IX_BURN_CHECKED:
        if (accounts[0]) burned.add(accounts[0]);
        break;
      case IX_CLOSE_ACCOUNT:
        if (accounts[0]) closed.add(accounts[0]);
        break;
      case IX_TRANSFER:
      case IX_TRANSFER_CHECKED:
      case IX_SET_AUTHORITY:
        break;
      case IX_SCALED_UI_AMOUNT: {
        if (program !== TOKEN_2022_PROGRAM) break;
        const mint = accounts[0];
        if (!mint) {
          anomalies.push(`ScaledUiAmount instruction at ${path.join('.')} has no mint account`);
          break;
        }
        if (!inScope(mint)) break;
        const cursor = { slot: tx.slot, txIndex: null, instructionPath: path };
        if (data[1] === SCALED_UI_UPDATE_MULTIPLIER && data.length >= 18) {
          multiplierWrites.push({
            mint,
            signature,
            cursor,
            clockUnix: blockTime,
            kind: 'update',
            multiplierBits: readFloat64Bits(data, 2),
            effectiveUnix: new DataView(data.buffer, data.byteOffset + 10, 8).getBigInt64(0, true),
          });
        } else if (data[1] === SCALED_UI_INITIALIZE && data.length >= 42) {
          multiplierWrites.push({
            mint,
            signature,
            cursor,
            clockUnix: blockTime,
            kind: 'initialize',
            multiplierBits: readFloat64Bits(data, 34),
            effectiveUnix: 0n,
          });
        } else {
          anomalies.push(`Unrecognized ScaledUiAmount instruction (variant ${data[1]}, ${data.length} bytes) at ${path.join('.')}`);
        }
        break;
      }
    }
  }

  if (meta.preTokenBalances == null || meta.postTokenBalances == null) {
    anomalies.push('Token balances were not recorded for this transaction');
    return { signature, slot: tx.slot, blockTime, failed: false, balanceChanges: [], multiplierWrites, anomalies };
  }

  const pre = new Map(meta.preTokenBalances.map((b) => [b.accountIndex, b]));
  const post = new Map(meta.postTokenBalances.map((b) => [b.accountIndex, b]));
  const balanceChanges: TokenBalanceChange[] = [];

  for (const accountIndex of new Set([...pre.keys(), ...post.keys()])) {
    const before = pre.get(accountIndex);
    const after = post.get(accountIndex);
    const mint = (before ?? after)!.mint;
    if (!inScope(mint)) continue;
    const account = key(accountIndex);
    if (before && after && before.mint !== after.mint) {
      anomalies.push(`${account}: mint changed within the transaction (${before.mint} → ${after.mint})`);
      continue;
    }
    if (before && !after && !closed.has(account)) {
      anomalies.push(`${account} is absent from post-transaction balances without a CloseAccount instruction`);
    }
    if ((before && before.owner === undefined) || (after && after.owner === undefined)) {
      anomalies.push(`${account}: token balance owner was not recorded`);
    }
    const rawBefore = before ? BigInt(before.uiTokenAmount.amount) : 0n;
    const rawAfter = after ? BigInt(after.uiTokenAmount.amount) : 0n;
    const ownerBefore = (before?.owner ?? null) as Address | null;
    const ownerAfter = (after?.owner ?? null) as Address | null;
    if (before && after && rawBefore === rawAfter && ownerBefore === ownerAfter) continue;

    const reason: MovementReason = !before
      ? 'open'
      : !after
        ? 'close'
        : ownerBefore !== ownerAfter
          ? 'owner_change'
          : minted.has(account)
            ? 'mint'
            : burned.has(account)
              ? 'burn'
              : 'transfer';

    balanceChanges.push({
      account,
      mint: mint as Address,
      tokenProgram: ((after ?? before)!.programId ?? null) as Address | null,
      ownerBefore,
      ownerAfter,
      rawBefore,
      rawAfter,
      reason,
    });
  }

  return { signature, slot: tx.slot, blockTime, failed: false, balanceChanges, multiplierWrites, anomalies };
}

/** JSON-safe copy of an RPC payload (bigints become decimal strings) for immutable storage. */
export function toStorablePayload(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
}
