import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { DocArticle } from '@/components/DocArticle';
import type { Heading } from '@/lib/docs';
import { highlight } from '@/lib/highlight';

export const metadata: Metadata = { title: 'API reference', description: 'Every endpoint, generated from the published OpenAPI document.' };

interface Schema {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
}
interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
  description?: string;
}
interface Operation {
  summary?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>;
  security?: unknown[];
}

// Route scopes live in the API's route config, not in the OpenAPI document.
const SCOPES: Record<string, string> = {
  'GET /v1/health': 'public',
  'GET /v1/assets': 'assets:read',
  'POST /v1/wallets/sync': 'wallets:sync',
  'GET /v1/ops/status': 'ops:read',
  'GET /v1/ops/metrics': 'ops:read',
};
const GROUP_ORDER = ['service', 'assets', 'wallets', 'ledger', 'ops'];
const GROUP_TITLES: Record<string, string> = { service: 'Service', assets: 'Assets', wallets: 'Wallets', ledger: 'Ledger', ops: 'Operations' };

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function typeLabel(schema: Schema | undefined): string {
  if (!schema) return '—';
  if (schema.anyOf) return schema.anyOf.map(typeLabel).join(' | ');
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : (schema.type ?? 'object');
  return type === 'array' ? `${typeLabel(schema.items)}[]` : type;
}

function constraints(schema: Schema | undefined): string {
  if (!schema) return '';
  const parts = [schema.description ?? ''];
  if (schema.default !== undefined) parts.push(`Default ${JSON.stringify(schema.default)}.`);
  if (schema.minimum !== undefined || schema.maximum !== undefined) parts.push(`Range ${schema.minimum ?? '…'}–${schema.maximum ?? '…'}.`);
  return parts.filter(Boolean).join(' ');
}

function exampleFor(method: string, path: string, op: Operation, scope: string): string {
  const query = (op.parameters ?? []).filter((p) => p.in === 'query' && p.required).map((p) => `${p.name}=<${p.name}>`);
  const url = `https://api.corpact.example${path.replace(/\{(\w+)\}/g, '<$1>')}${query.length ? `?${query.join('&')}` : ''}`;
  const lines = [`curl -s ${method !== 'GET' ? `-X ${method} ` : ''}"${url}"`];
  if (scope !== 'public') lines.push('  -H "authorization: Bearer $CORPACT_API_KEY"');
  if (op.requestBody) lines.push(`  -H 'content-type: application/json'`, `  -d '{"owner":"<wallet address>"}'`);
  return lines.join(' \\\n');
}

export default async function ApiReference() {
  const spec = JSON.parse(readFileSync(join(process.cwd(), '../../packages/client/openapi.json'), 'utf8')) as {
    info: { version: string };
    paths: Record<string, Record<string, Operation>>;
  };

  const operations = Object.entries(spec.paths)
    .flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method: method.toUpperCase(), op })))
    .filter((o) => o.op.summary);
  const groups = [...new Set(operations.map((o) => o.op.tags?.[0] ?? 'service'))].sort(
    (a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99),
  );

  const headings: Heading[] = [];
  const sections = await Promise.all(
    groups.map(async (group) => {
      const title = GROUP_TITLES[group] ?? group;
      headings.push({ id: slug(title), text: title, depth: 2 });
      const endpoints = await Promise.all(
        operations
          .filter((o) => (o.op.tags?.[0] ?? 'service') === group)
          .map(async ({ path, method, op }) => {
            const id = slug(`${method} ${path}`);
            headings.push({ id, text: `${method} ${path}`, depth: 3 });
            const scope = SCOPES[`${method} ${path}`] ?? 'ledger:read';
            const params = op.parameters ?? [];
            const body = op.requestBody?.content?.['application/json']?.schema;
            const ok = Object.entries(op.responses ?? {}).find(([code]) => code.startsWith('2'));
            const okSchema = ok?.[1].content?.['application/json']?.schema;
            const example = await highlight(exampleFor(method, path, op, scope), 'bash');
            return (
              <section className="endpoint" key={id}>
                <h3 id={id}>
                  <a className="anchor" href={`#${id}`} aria-hidden="true">
                    #
                  </a>
                  {op.summary}
                </h3>
                <div className="endpoint-head">
                  <span className={`method ${method.toLowerCase()}`}>{method}</span>
                  <code>{path}</code>
                  <span className={`chip ${scope === 'public' ? 'green' : 'accent'} scope`}>{scope === 'public' ? 'No key required' : `Scope: ${scope}`}</span>
                </div>

                {params.length > 0 && (
                  <table>
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th>In</th>
                        <th>Type</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {params.map((p) => (
                        <tr key={`${p.in}-${p.name}`}>
                          <td>
                            <code>{p.name}</code>
                            {p.required ? ' *' : ''}
                          </td>
                          <td>{p.in}</td>
                          <td>
                            <code>{typeLabel(p.schema)}</code>
                          </td>
                          <td>{constraints(p.schema) || p.description || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {body?.properties && (
                  <table>
                    <thead>
                      <tr>
                        <th>Body field</th>
                        <th>Type</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(body.properties).map(([name, schema]) => (
                        <tr key={name}>
                          <td>
                            <code>{name}</code>
                            {body.required?.includes(name) ? ' *' : ''}
                          </td>
                          <td>
                            <code>{typeLabel(schema)}</code>
                          </td>
                          <td>{constraints(schema)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {okSchema?.properties && (
                  <table>
                    <thead>
                      <tr>
                        <th>Response field ({ok![0]})</th>
                        <th>Type</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(okSchema.properties).map(([name, schema]) => (
                        <tr key={name}>
                          <td>
                            <code>{name}</code>
                          </td>
                          <td>
                            <code>{typeLabel(schema)}</code>
                          </td>
                          <td>{constraints(schema)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <p>
                  Responses:{' '}
                  {Object.keys(op.responses ?? {}).map((code, i) => (
                    <span key={code}>
                      {i > 0 ? ', ' : ''}
                      <code>{code}</code>
                    </span>
                  ))}
                </p>
                <div className="code-frame" dangerouslySetInnerHTML={{ __html: example }} />
              </section>
            );
          }),
      );
      return (
        <div key={group}>
          <h2 id={slug(title)}>
            <a className="anchor" href={`#${slug(title)}`} aria-hidden="true">
              #
            </a>
            {title}
          </h2>
          {endpoints}
        </div>
      );
    }),
  );

  return (
    <DocArticle
      slug="api-reference"
      group="Reference"
      title="API reference"
      description={`Every endpoint in API version ${spec.info.version}, generated from the published OpenAPI 3.1 document at /v1/openapi.json.`}
      headings={headings}
    >
      <div className="prose">
        <p>
          All endpoints except <code>/v1/health</code> and <code>/v1/openapi.json</code> need an API key with the listed scope. Fields marked * are required. The
          same schemas generate server validation and the <a href="/docs/reference/client">TypeScript client</a>.
        </p>
        {sections}
      </div>
    </DocArticle>
  );
}
