import { describe, expect, it } from 'vitest';
import { CorpactApiError, createCorpactClient } from './client';

const OWNER = '6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U';

function recordingFetch(status: number, body: string) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('createCorpactClient', () => {
  it('builds URLs against a relative proxy path and sends no credentials of its own', async () => {
    const { calls, fetchImpl } = recordingFetch(200, JSON.stringify({ owner: OWNER, entries: [], nextOffset: null }));
    const client = createCorpactClient({ baseUrl: '/api/corpact/', fetch: fetchImpl });
    await client.income(OWNER, { limit: 200 });
    expect(calls[0]?.url).toBe(`/api/corpact/v1/income?owner=${OWNER}&limit=200`);
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('sends the API key as a bearer token when given one', async () => {
    const { calls, fetchImpl } = recordingFetch(200, '{"ok":true}');
    await createCorpactClient({ baseUrl: 'https://api.example', apiKey: 'cpk_secret', fetch: fetchImpl }).health();
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer cpk_secret');
  });

  it('posts JSON for a sync request', async () => {
    const { calls, fetchImpl } = recordingFetch(202, JSON.stringify({ owner: OWNER, status: 'queued', job: 'enqueued' }));
    const result = await createCorpactClient({ baseUrl: 'https://api.example', fetch: fetchImpl }).requestSync(OWNER);
    expect(result.job).toBe('enqueued');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ owner: OWNER }));
    expect((calls[0]?.init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('surfaces the API error message and status', async () => {
    const { fetchImpl } = recordingFetch(401, '{"error":"Invalid or revoked API key"}');
    const promise = createCorpactClient({ baseUrl: 'https://api.example', fetch: fetchImpl }).assets();
    await expect(promise).rejects.toBeInstanceOf(CorpactApiError);
    await expect(promise).rejects.toMatchObject({ status: 401, message: 'Invalid or revoked API key' });
  });

  it('reports non-JSON failures with the HTTP status instead of a parse error', async () => {
    const { fetchImpl } = recordingFetch(502, '<html>Bad gateway</html>');
    await expect(createCorpactClient({ baseUrl: 'https://api.example', fetch: fetchImpl }).assets()).rejects.toMatchObject({
      status: 502,
      message: 'HTTP 502 from /v1/assets',
    });
  });
});
