import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createDb } from '@corpact/db';

export const REPO_ROOT = join(import.meta.dirname, '../../..');
const WORKER_DIR = join(REPO_ROOT, 'apps/worker');

/** The only database the demo creates or drops. */
export const DEMO_DATABASE = 'corpact_demo';
export const DEFAULT_ADMIN_DATABASE_URL = 'postgres://parityfi:parityfi-dev@127.0.0.1:54329/parityfi';

function assertLocalDatabase(url: string): void {
  const { hostname } = new URL(url);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') throw new Error(`Refusing to create the demo database on ${hostname}`);
}

export function demoDatabaseUrl(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${DEMO_DATABASE}`;
  return url.toString();
}

/** Drop and recreate `corpact_demo`, so every run starts empty and never touches the real ledger. */
export async function recreateDemoDatabase(adminUrl: string): Promise<string> {
  assertLocalDatabase(adminUrl);
  const admin = createDb(adminUrl);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DEMO_DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DEMO_DATABASE}`);
  } finally {
    await admin.end();
  }
  return demoDatabaseUrl(adminUrl);
}

export interface WorkerEnv {
  databaseUrl: string;
  rpcUrl: string;
  fixturesDir: string;
  /** The independent reconciliation provider (the demo's local proxy). */
  reconciliationRpcUrl?: string;
}

/**
 * Run a worker CLI command against the demo database, local validator and synthetic fixtures.
 * The environment is built from scratch and the repo `.env` is not loaded, so neither the real
 * database nor the configured mainnet RPC can leak in.
 */
export function runWorker(args: readonly string[], env: WorkerEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(WORKER_DIR, 'node_modules/.bin/tsx'), ['src/main.ts', ...args], {
      cwd: WORKER_DIR,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        DATABASE_URL: env.databaseUrl,
        SOLANA_RPC_URL: env.rpcUrl,
        ...(env.reconciliationRpcUrl ? { RECONCILIATION_RPC_URL: env.reconciliationRpcUrl } : {}),
        ISSUER_SOURCE: 'fixtures',
        ISSUER_FIXTURES_DIR: env.fixturesDir,
        WORKER_ID: 'demo',
        RPC_MAX_CONCURRENCY: '4',
        RPC_MIN_INTERVAL_MS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`worker ${args.join(' ')} exited ${code}:\n${stderr.split('\n').slice(-15).join('\n')}`));
    });
  });
}
