import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RpcProxy {
  url: string;
  /** Misreport this token account's balance by one raw unit in getTokenAccountsByOwner; null to be honest again. */
  misreport(account: string | null): void;
  close(): Promise<void>;
}

/**
 * A stand-in "independent provider": forwards JSON-RPC to the local validator on its own origin,
 * and can be told to lie about one token balance. Responses are edited as text, never re-serialized,
 * so u64 fields keep their exact digits.
 */
export async function startRpcProxy(upstream: string): Promise<RpcProxy> {
  let target: string | null = null;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString();
      try {
        const upstreamResponse = await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        let text = await upstreamResponse.text();
        if (target !== null) text = misreportBalance(body, text, target);
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

  return {
    url: `http://127.0.0.1:${port}`,
    misreport: (account) => {
      target = account;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function misreportBalance(requestBody: string, responseText: string, account: string): string {
  const request = JSON.parse(requestBody) as { method?: string };
  if (request.method !== 'getTokenAccountsByOwner') return responseText;
  // Strings survive JSON.parse exactly; use the parse only to find the account's base64 data.
  const entries = (JSON.parse(responseText) as { result?: { value?: Array<{ pubkey: string; account: { data: [string, string] } }> } }).result?.value ?? [];
  const entry = entries.find((e) => e.pubkey === account);
  if (!entry) return responseText;
  const data = Buffer.from(entry.account.data[0], 'base64');
  data.writeBigUInt64LE(data.readBigUInt64LE(64) + 1n, 64); // token account amount
  return responseText.replace(entry.account.data[0], data.toString('base64'));
}
