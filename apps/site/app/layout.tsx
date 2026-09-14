import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Outfit } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const display = Outfit({ subsets: ['latin'], variable: '--font-display', weight: ['300', '400', '500', '600'] });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: { default: 'Corpact: every corporate action, accounted for', template: '%s · Corpact Docs' },
  description:
    'Corpact is an API-first ledger for tokenized stocks: evidence-backed dividends, splits and corrections from on-chain multiplier changes.',
};

// Runs before paint so a saved light theme never flashes dark.
const THEME_SCRIPT = `try{var t=localStorage.getItem('corpact-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
