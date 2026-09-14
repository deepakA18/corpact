import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Local JSON-RPC proxies for the demo. Responses are edited as text, never re-serialized,
 * so u64 fields keep their exact digits.
 */

type Transform = (method: string, requestBody: string, responseText: string) => Promise<string>;

async function startProxy(upstream: string, transform: Transform): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString();
      try {
        const method = (JSON.parse(body) as { method?: string }).method ?? '';
        const upstreamResponse = await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        const text = await transform(method, body, await upstreamResponse.text());
        res.writeHead(upstreamResponse.status, { 'content-type': 'application/json' });
        res.end(text);
      } catch (error) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: String(error) } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

export interface ProviderProxy {
  url: string;
  /** Misreport this token account's balance by one raw unit in getTokenAccountsByOwner; null to be honest again. */
  misreport(account: string | null): void;
  close(): Promise<void>;
}

/** A stand-in "independent provider" on its own origin: honest, or lying about one token balance. */
export async function startProviderProxy(upstream: string): Promise<ProviderProxy> {
  let target: string | null = null;
  const proxy = await startProxy(upstream, async (method, _body, text) =>
    target !== null && method === 'getTokenAccountsByOwner' ? misreportBalance(text, target) : text,
  );
  return { url: proxy.url, misreport: (account) => void (target = account), close: proxy.close };
}

function misreportBalance(responseText: string, account: string): string {
  // Strings survive JSON.parse exactly; the parse only locates the account's base64 data.
  const entries = (JSON.parse(responseText) as { result?: { value?: Array<{ pubkey: string; account: { data: [string, string] } }> } }).result?.value ?? [];
  const entry = entries.find((e) => e.pubkey === account);
  if (!entry) return responseText;
  const data = Buffer.from(entry.account.data[0], 'base64');
  data.writeBigUInt64LE(data.readBigUInt64LE(64) + 1n, 64); // token account amount
  return responseText.replace(entry.account.data[0], data.toString('base64'));
}

/**
 * Surfpool 1.0.0 compatibility, at the RPC boundary so the production worker runs unmodified.
 * Surfpool returns `blockTime` divided by 1000 from getTransaction and getBlock (the seconds are lost),
 * and null from getSignaturesForAddress. Both are restored from Surfpool's own getBlockTime(slot),
 * which is correct. Nothing else is touched.
 */
export async function startSurfpoolCompatProxy(upstream: string): Promise<{ url: string; close(): Promise<void> }> {
  const times = new Map<number, number>();
  const blockTime = async (slot: number): Promise<number | null> => {
    const cached = times.get(slot);
    if (cached !== undefined) return cached;
    const res = await fetch(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockTime', params: [slot] }),
    });
    const time = ((await res.json()) as { result?: number | null }).result ?? null;
    if (time !== null) times.set(slot, time);
    return time;
  };

  return startProxy(upstream, async (method, body, text) => {
    if (!text.includes('"blockTime"')) return text;
    if (method === 'getTransaction' || method === 'getBlock') {
      const slot = method === 'getTransaction' ? (JSON.parse(text) as { result?: { slot?: number } }).result?.slot : (JSON.parse(body) as { params?: unknown[] }).params?.[0];
      if (typeof slot !== 'number') return text;
      const time = await blockTime(slot);
      return text.replace(/"blockTime":(null|\d+)/, `"blockTime":${time ?? 'null'}`);
    }
    if (method === 'getSignaturesForAddress') {
      const entries = ((JSON.parse(text) as { result?: Array<{ slot: number }> }).result ?? []);
      const resolved = await Promise.all(entries.map((e) => blockTime(e.slot)));
      let i = 0;
      // One blockTime per entry, in array order.
      return text.replace(/"blockTime":(null|\d+)/g, () => `"blockTime":${resolved[i++] ?? 'null'}`);
    }
    return text;
  });
}
