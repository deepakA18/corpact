import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Corpact demo — corporate-action accounting for tokenized stocks',
  description: 'Reference dashboard for the Corpact engine: evidence-backed dividend accounting for xStocks on Solana.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <main className="shell">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
