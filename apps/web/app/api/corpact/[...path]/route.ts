import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the Corpact API. The API key lives only in this server's
 * environment; the browser never sees it. Only the routes the dashboard needs pass.
 */
const API_URL = (process.env.CORPACT_API_URL ?? 'http://127.0.0.1:4600').replace(/\/+$/, '');
const ALLOWED = /^v1\/(assets|portfolio|income|income\/\d+|yield|export|wallets|wallets\/sync|wallets\/[1-9A-HJ-NP-Za-km-z]{32,44}\/status)$/;
const FORWARDED_HEADERS = ['retry-after', 'content-disposition'];

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, context: Context, method: 'GET' | 'POST'): Promise<Response> {
  const { path } = await context.params;
  const route = path.join('/');
  if (!ALLOWED.test(route)) return Response.json({ error: 'Not found' }, { status: 404 });

  const apiKey = process.env.CORPACT_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'The dashboard server has no CORPACT_API_KEY configured' }, { status: 500 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/${route}${request.nextUrl.search}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: request.headers.get('accept') ?? 'application/json',
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      body: method === 'POST' ? await request.text() : undefined,
      cache: 'no-store',
    });
  } catch {
    return Response.json({ error: 'The Corpact API is unreachable' }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      ...Object.fromEntries(FORWARDED_HEADERS.flatMap((name) => (upstream.headers.has(name) ? [[name, upstream.headers.get(name)!]] : []))),
    },
  });
}

export function GET(request: NextRequest, context: Context) {
  return forward(request, context, 'GET');
}

export function POST(request: NextRequest, context: Context) {
  return forward(request, context, 'POST');
}
