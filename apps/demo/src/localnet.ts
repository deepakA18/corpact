import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startSurfpoolCompatProxy } from './proxy';

export const LOCAL_RPC_URL = 'http://127.0.0.1:8899';
export const LOCAL_WS_URL = 'ws://127.0.0.1:8900';

export type ValidatorKind = 'surfpool' | 'solana-test-validator';

/** The demo signs with throwaway keys; it must never reach a real cluster. */
export function assertLocalRpc(url: string): void {
  const { hostname } = new URL(url);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error(`Refusing to run the demo against ${hostname}: it only targets a local network`);
  }
}

async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    return ((await res.json()) as { result?: string }).result === 'ok';
  } catch {
    return false;
  }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(LOCAL_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return ((await res.json()) as { result?: T }).result ?? null;
  } catch {
    return null;
  }
}

async function hasBlockTime(commitment: 'confirmed' | 'finalized'): Promise<boolean> {
  const slot = await rpc<number>('getSlot', [{ commitment }]);
  return slot !== null && (await rpc<number>('getBlockTime', [slot])) !== null;
}

export interface Localnet {
  kind: ValidatorKind;
  /** What the demo's own kit client uses. */
  rpcUrl: string;
  wsUrl: string;
  /** What the production worker uses: the node itself, or a compatibility layer in front of it. */
  workerRpcUrl: string;
  stop(): Promise<void>;
}

/**
 * A fresh local network. Surfpool runs `--offline`: no mainnet datasource, so nothing but the
 * demo's own synthetic accounts exists beside the built-in programs.
 */
export async function startLocalnet(kind: ValidatorKind, runDir: string): Promise<Localnet> {
  assertLocalRpc(LOCAL_RPC_URL);
  if (await healthy(LOCAL_RPC_URL)) {
    throw new Error(`Something is already serving ${LOCAL_RPC_URL}; stop it so the demo starts from an empty ledger`);
  }
  const dir = join(runDir, kind);
  mkdirSync(dir, { recursive: true });
  const child: ChildProcess =
    kind === 'surfpool'
      ? spawn('surfpool', ['start', '--offline', '--no-tui', '--no-deploy', '--no-studio', '-y'], { cwd: dir, stdio: 'ignore' })
      : spawn('solana-test-validator', ['--reset', '--quiet', '--ledger', join(dir, 'ledger')], { stdio: 'ignore' });
  let exited: string | null = null;
  child.on('error', (error) => (exited = `${kind} failed to start: ${error.message}`));
  child.on('exit', (code, signal) => (exited = `${kind} exited (${signal ?? code})`));

  const deadline = Date.now() + 90_000;
  while (!(await healthy(LOCAL_RPC_URL))) {
    if (exited) throw new Error(exited);
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error(`${kind} did not become healthy within 90 s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // A fresh node has no block times for slots it did not produce (Surfpool: about 12 s at the finalized
  // commitment). The worker settles everything on finalized time, so wait until that exists.
  while (!(await hasBlockTime('confirmed')) || !(await hasBlockTime('finalized'))) {
    if (exited) throw new Error(exited);
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`${kind} produced no finalized block time within 90 s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const compat = kind === 'surfpool' ? await startSurfpoolCompatProxy(LOCAL_RPC_URL) : null;
  return {
    kind,
    rpcUrl: LOCAL_RPC_URL,
    wsUrl: LOCAL_WS_URL,
    workerRpcUrl: compat?.url ?? LOCAL_RPC_URL,
    stop: async () => {
      await compat?.close();
      if (exited) return;
      // Surfpool 1.0.0 ignores SIGTERM: wait briefly, then force it, so no run leaves a node behind.
      const gone = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      const stopped = await Promise.race([gone.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000))]);
      if (!stopped) {
        child.kill('SIGKILL');
        await gone;
      }
    },
  };
}
