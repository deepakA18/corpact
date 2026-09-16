import type { Metadata } from 'next';
import { DocArticle } from '@/components/DocArticle';
import { TryIt } from '@/components/TryIt';
import { DEMO_API_KEY, DEMO_API_URL, DEMO_WALLET } from '@/lib/demo-api';
import type { Heading } from '@/lib/docs';
import { highlight } from '@/lib/highlight';

export const metadata: Metadata = {
  title: 'Try the API',
  description: 'Call the hosted Corpact API from this page and see real responses, with no setup.',
};

const HEADINGS: Heading[] = [
  { id: 'live-requests', text: 'Live requests', depth: 2 },
  { id: 'from-your-terminal', text: 'From your terminal', depth: 2 },
  { id: 'in-typescript', text: 'In TypeScript', depth: 2 },
  { id: 'about-this-demo', text: 'About this demo', depth: 2 },
];

const CURL = `curl -s "${DEMO_API_URL}/v2/actions?owner=${DEMO_WALLET}&limit=5" \\
  -H "authorization: Bearer ${DEMO_API_KEY}"`;

const TS = `import { createCorpactClient } from '@corpact/client';

const corpact = createCorpactClient({
  baseUrl: '${DEMO_API_URL}',
  apiKey: '${DEMO_API_KEY}', // read-only demo key
});

const { actions } = await corpact.v2.actions('${DEMO_WALLET}');

for (const a of actions) {
  console.log(a.type, a.treatment, a.quantityDisplay, a.usd ?? 'USD unknown');
}`;

export default async function TryItPage() {
  const [curl, ts] = await Promise.all([highlight(CURL, 'bash'), highlight(TS, 'ts')]);

  return (
    <DocArticle
      slug="try-it"
      group="Getting Started"
      title="Try the API"
      description="Call the hosted Corpact API from this page and see real responses, with no setup."
      headings={HEADINGS}
    >
      <div className="prose">
        <h2 id="live-requests">
          <a href="#live-requests" className="anchor" aria-hidden="true">
            #
          </a>
          Live requests
        </h2>
        <p>
          Every request below runs against the hosted API on mainnet data, from your browser, using a read-only demo key. Pick one and press <strong>Run</strong>.
        </p>
      </div>

      <TryIt />

      <div className="prose tryit-page">
        <h2 id="from-your-terminal">
          <a href="#from-your-terminal" className="anchor" aria-hidden="true">
            #
          </a>
          From your terminal
        </h2>
        <p>The same call with curl:</p>
        <div className="code-frame" dangerouslySetInnerHTML={{ __html: curl }} />

        <h2 id="in-typescript">
          <a href="#in-typescript" className="anchor" aria-hidden="true">
            #
          </a>
          In TypeScript
        </h2>
        <div className="code-frame" dangerouslySetInnerHTML={{ __html: ts }} />
        <p>
          See the <a href="/docs/reference/client">TypeScript client</a> for every method, and the <a href="/docs/api-reference">API reference</a> for every field.
        </p>

        <h2 id="about-this-demo">
          <a href="#about-this-demo" className="anchor" aria-hidden="true">
            #
          </a>
          About this demo
        </h2>
        <ul>
          <li>
            <strong>Read-only.</strong> The key holds <code>assets:read</code> and <code>ledger:read</code> only. It cannot sync wallets or change anything.
          </li>
          <li>
            <strong>One wallet.</strong> It belongs to a demo tenant with a single registered wallet, <code>{DEMO_WALLET}</code>. Any other wallet answers{' '}
            <code>404 wallet_not_registered</code>, which is how tenant isolation works for every customer.
          </li>
          <li>
            <strong>Real mainnet data.</strong> Chain history comes from Solana; corporate actions come from recorded issuer data.
          </li>
          <li>
            <strong>Shared limits.</strong> The key is rate-limited and shared by everyone reading these docs. For your own key and your own wallets, follow the{' '}
            <a href="/docs/quickstart">Quickstart</a>.
          </li>
        </ul>
      </div>
    </DocArticle>
  );
}
