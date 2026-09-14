import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Corpact demo — corporate-action accounting for tokenized stocks',
  description: 'Reference dashboard for the Corpact engine: evidence-backed dividend accounting for xStocks on Solana.',
};

const API_URL = (process.env.CORPACT_API_URL ?? 'http://127.0.0.1:4600').replace(/\/+$/, '');

/** Read server-side from the public health route, so the label cannot be forgotten in any view. */
async function datasetLabel(): Promise<{ kind: string; description: string | null } | null> {
  try {
    const res = await fetch(`${API_URL}/v1/health`, { cache: 'no-store' });
    return ((await res.json()) as { dataset?: { kind: string; description: string | null } }).dataset ?? null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const dataset = await datasetLabel();
  return (
    <html lang="en">
      <body>
        {dataset?.kind === 'synthetic' && (
          <div className="synthetic-banner" role="alert">
            <strong>SYNTHETIC DEMO DATA</strong> — {dataset.description ?? 'generated on a local network; not mainnet history or issuer data'}
          </div>
        )}
        <Providers>
          <main className="shell">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
