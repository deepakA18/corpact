import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';

export const LOCAL_RPC_URL = 'http://127.0.0.1:8899';
export const LOCAL_WS_URL = 'ws://127.0.0.1:8900';

/** The demo signs with throwaway keys; it must never reach a real cluster. */
export function assertLocalRpc(url: string): void {
  const { hostname } = new URL(url);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error(`Refusing to run the demo against ${hostname}: it only targets a local test validator`);
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

export interface Localnet {
  rpcUrl: string;
  wsUrl: string;
  stop(): void;
}

/** A fresh `solana-test-validator` with its ledger under the run directory. */
export async function startLocalnet(ledgerDir: string, log: (line: string) => void): Promise<Localnet> {
  assertLocalRpc(LOCAL_RPC_URL);
  if (await healthy(LOCAL_RPC_URL)) {
    throw new Error(`Something is already serving ${LOCAL_RPC_URL}; stop it so the demo starts from an empty ledger`);
  }
  mkdirSync(ledgerDir, { recursive: true });
  const child: ChildProcess = spawn('solana-test-validator', ['--reset', '--quiet', '--ledger', ledgerDir], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let exited: string | null = null;
  child.on('exit', (code, signal) => {
    exited = `solana-test-validator exited (${signal ?? code})`;
  });
  child.stderr?.on('data', (chunk: Buffer) => log(chunk.toString().trim()));

  const deadline = Date.now() + 90_000;
  while (!(await healthy(LOCAL_RPC_URL))) {
    if (exited) throw new Error(exited);
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error('solana-test-validator did not become healthy within 90 s');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { rpcUrl: LOCAL_RPC_URL, wsUrl: LOCAL_WS_URL, stop: () => child.kill('SIGTERM') };
}
