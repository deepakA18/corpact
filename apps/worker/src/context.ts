import { randomUUID } from 'node:crypto';
import { createDb, type Db } from '@corpact/db';
import { issuerSourceFromEnv, type IssuerSource } from '@corpact/issuers';
import { createChainReader, type ChainReader } from '@corpact/solana';

export interface WorkerConfig {
  databaseUrl: string;
  rpcUrl: string;
  rpcMaxConcurrency: number;
  rpcMinIntervalMs: number;
  mintPollSeconds: number;
  walletMaxSignatures: number;
  /** Restrict the registry to these symbols; null means every recorded Solana xStock. */
  allowlistSymbols: string[] | null;
  workerId: string;
}

const positiveInt = (name: string, raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  return n;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://parityfi:parityfi-dev@127.0.0.1:54329/parityfi',
    rpcUrl: env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
    rpcMaxConcurrency: positiveInt('RPC_MAX_CONCURRENCY', env.RPC_MAX_CONCURRENCY, 2),
    rpcMinIntervalMs: positiveInt('RPC_MIN_INTERVAL_MS', env.RPC_MIN_INTERVAL_MS, 150),
    mintPollSeconds: positiveInt('MINT_POLL_SECONDS', env.MINT_POLL_SECONDS, 45),
    walletMaxSignatures: positiveInt('WALLET_MAX_SIGNATURES', env.WALLET_MAX_SIGNATURES, 5000),
    allowlistSymbols: env.ALLOWLIST_SYMBOLS ? env.ALLOWLIST_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean) : null,
    workerId: env.WORKER_ID ?? `worker-${randomUUID().slice(0, 8)}`,
  };
}

export type LogLevel = 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string, fields?: Record<string, unknown>) => void;

export const log: Logger = (level, message, fields = {}) => {
  console.error(
    JSON.stringify({ t: new Date().toISOString(), level, message, ...fields }, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v instanceof Error ? `${v.name}: ${v.message}` : v,
    ),
  );
};

export interface Context {
  db: Db;
  chain: ChainReader;
  issuer: IssuerSource;
  config: WorkerConfig;
  log: Logger;
}

export function createContext(config: WorkerConfig = loadConfig()): Context {
  const issuer = issuerSourceFromEnv();
  const chain = createChainReader({
    rpcUrl: config.rpcUrl,
    maxConcurrency: config.rpcMaxConcurrency,
    minIntervalMs: config.rpcMinIntervalMs,
    onRetry: (label, attempt, error) => log('warn', 'rpc retry', { label, attempt, error }),
  });
  // RPC URLs often embed an API key: log the host only.
  log('info', 'context', { rpcHost: new URL(config.rpcUrl).host, issuerSource: issuer.kind, workerId: config.workerId });
  return { db: createDb(config.databaseUrl), chain, issuer, config, log };
}

export const unixOf = (date: Date): bigint => BigInt(Math.floor(date.getTime() / 1000));
export const isoOf = (unix: bigint): string => new Date(Number(unix) * 1000).toISOString();
