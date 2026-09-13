import {
  address,
  createSolanaRpc,
  getAddressDecoder,
  getBase64Encoder,
  signature as toSignature,
  type Address,
} from '@solana/kit';

export interface ChainReaderOptions {
  rpcUrl: string;
  /** Concurrent in-flight requests. Public mainnet tolerates very little. */
  maxConcurrency?: number;
  /** Minimum spacing between request starts. */
  minIntervalMs?: number;
  maxAttempts?: number;
  onRetry?: (label: string, attempt: number, error: unknown) => void;
}

export class ChainReadError extends Error {
  override name = 'ChainReadError';
  constructor(
    readonly label: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${label}: ${message}`, options);
  }
}

export interface TokenAccountSnapshot {
  address: Address;
  mint: Address;
  owner: Address;
  amount: bigint;
  tokenProgram: Address;
}

export interface SignatureInfo {
  signature: string;
  slot: bigint;
  blockTime: bigint | null;
  failed: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** True when an error (or anything in its cause chain) is an HTTP 429 from the RPC provider. */
function isRateLimited(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const record = e as { statusCode?: unknown; context?: { statusCode?: unknown }; cause?: unknown };
    if (record.statusCode === 429 || record.context?.statusCode === 429) return true;
    e = record.cause;
  }
  return false;
}
const TOKEN_ACCOUNT_BASE_LENGTH = 165;
const ACCOUNT_TYPE_TOKEN_ACCOUNT = 2;

function createLimiter(maxConcurrency: number, minIntervalMs: number) {
  let active = 0;
  let nextStart = 0;
  const waiters: Array<() => void> = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= maxConcurrency) await new Promise<void>((resolve) => waiters.push(resolve));
    active++;
    try {
      const now = Date.now();
      const startAt = Math.max(now, nextStart);
      nextStart = startAt + minIntervalMs;
      if (startAt > now) await sleep(startAt - now);
      return await fn();
    } finally {
      active--;
      waiters.shift()?.();
    }
  };
}

/** Read-only, finalized-commitment chain access with pacing and bounded retries. */
export function createChainReader(options: ChainReaderOptions) {
  const rpc = createSolanaRpc(options.rpcUrl);
  const limit = createLimiter(options.maxConcurrency ?? 2, options.minIntervalMs ?? 150);
  const maxAttempts = options.maxAttempts ?? 10;
  const base64 = getBase64Encoder();
  const addressDecoder = getAddressDecoder();

  async function call<T>(label: string, request: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await limit(request);
      } catch (err) {
        lastError = err;
        if (attempt === maxAttempts) break;
        options.onRetry?.(label, attempt, err);
        // Provider quotas refill over seconds; back off much harder on 429 than on transient network errors.
        const base = isRateLimited(err) ? 2_000 : 500;
        await sleep(Math.min(60_000, base * 2 ** (attempt - 1)) * (0.5 + Math.random() / 2));
      }
    }
    throw new ChainReadError(label, `failed after ${maxAttempts} attempts`, { cause: lastError });
  }

  return {
    rpcUrl: options.rpcUrl,

    /** Latest finalized slot and its Clock timestamp. Settlement evidence — never local wall-clock time. */
    async finalizedClock(): Promise<{ slot: bigint; unixTime: bigint }> {
      const slot = await call('getSlot', () => rpc.getSlot({ commitment: 'finalized' }).send());
      const time = await call(`getBlockTime(${slot})`, () => rpc.getBlockTime(slot).send());
      if (time === null) throw new ChainReadError(`getBlockTime(${slot})`, 'finalized slot has no block time');
      return { slot, unixTime: BigInt(time) };
    },

    /** Raw account data. `slot` is the oldest context slot across batches. */
    async accounts(addresses: readonly string[]) {
      const result = new Map<string, { owner: Address; data: Uint8Array } | null>();
      let slot: bigint | null = null;
      for (let i = 0; i < addresses.length; i += 100) {
        const batch = addresses.slice(i, i + 100).map((a) => address(a));
        const { context, value } = await call(`getMultipleAccounts[${i}..${i + batch.length}]`, () =>
          rpc.getMultipleAccounts(batch, { encoding: 'base64', commitment: 'finalized' }).send(),
        );
        slot = slot === null || context.slot < slot ? context.slot : slot;
        value.forEach((account, k) => {
          result.set(batch[k]!, account === null ? null : { owner: account.owner, data: new Uint8Array(base64.encode(account.data[0])) });
        });
      }
      return { slot: slot ?? 0n, accounts: result };
    },

    /** Current inventory only — not history. */
    async tokenAccountsByOwner(owner: string, tokenProgram: Address) {
      const { context, value } = await call(`getTokenAccountsByOwner(${owner})`, () =>
        rpc
          .getTokenAccountsByOwner(address(owner), { programId: tokenProgram }, { encoding: 'base64', commitment: 'finalized' })
          .send(),
      );
      const accounts: TokenAccountSnapshot[] = [];
      for (const { pubkey, account } of value) {
        const data = new Uint8Array(base64.encode(account.data[0]));
        if (account.owner !== tokenProgram) {
          throw new ChainReadError(`getTokenAccountsByOwner(${owner})`, `${pubkey} is owned by ${account.owner}, not ${tokenProgram}`);
        }
        if (data.length < TOKEN_ACCOUNT_BASE_LENGTH) {
          throw new ChainReadError(`getTokenAccountsByOwner(${owner})`, `${pubkey} has ${data.length} bytes; not a token account`);
        }
        if (data.length > TOKEN_ACCOUNT_BASE_LENGTH && data[TOKEN_ACCOUNT_BASE_LENGTH] !== ACCOUNT_TYPE_TOKEN_ACCOUNT) {
          throw new ChainReadError(`getTokenAccountsByOwner(${owner})`, `${pubkey} is not marked as a token account`);
        }
        const accountOwner = addressDecoder.decode(data.subarray(32, 64));
        if (accountOwner !== owner) {
          throw new ChainReadError(`getTokenAccountsByOwner(${owner})`, `${pubkey} decodes to owner ${accountOwner}`);
        }
        accounts.push({
          address: pubkey,
          mint: addressDecoder.decode(data.subarray(0, 32)),
          owner: accountOwner,
          amount: new DataView(data.buffer, data.byteOffset + 64, 8).getBigUint64(0, true),
          tokenProgram,
        });
      }
      return { slot: context.slot, accounts };
    },

    /** One page, newest first. `before` may be any signature, including one outside this address's history. */
    async signaturesPage(forAddress: string, page: { before?: string; limit?: number } = {}): Promise<SignatureInfo[]> {
      const rows = await call(`getSignaturesForAddress(${forAddress})`, () =>
        rpc
          .getSignaturesForAddress(address(forAddress), {
            commitment: 'finalized',
            limit: page.limit ?? 1000,
            ...(page.before ? { before: toSignature(page.before) } : {}),
          })
          .send(),
      );
      return rows.map((r) => ({
        signature: r.signature,
        slot: r.slot,
        blockTime: r.blockTime === null ? null : BigInt(r.blockTime),
        failed: r.err !== null,
      }));
    },

    /** Raw `getTransaction` result (encoding "json"), or null if the node has no record of it. */
    async transaction(sig: string): Promise<unknown> {
      return call(`getTransaction(${sig})`, () =>
        rpc
          .getTransaction(toSignature(sig), { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'finalized' })
          .send(),
      );
    },

    /** Ordered signatures of a block — the only source of a transaction's index within its slot. */
    async blockSignatures(slot: bigint): Promise<string[]> {
      const block = await call(`getBlock(${slot})`, () =>
        rpc
          .getBlock(slot, { transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 0, commitment: 'finalized' })
          .send(),
      );
      if (block === null) throw new ChainReadError(`getBlock(${slot})`, 'block not available');
      return [...block.signatures];
    },
  };
}

export type ChainReader = ReturnType<typeof createChainReader>;
