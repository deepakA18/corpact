import type { Metadata } from 'next';
import { Archivo, Inter, JetBrains_Mono, Silkscreen } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Archivo is a grotesque drawn for signage: the right register for a machined panel, and it replaces
// Outfit at the same variable name so no docs rule changes.
const display = Archivo({ subsets: ['latin'], variable: '--font-display' });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
// Legends and numerals only, at 11px and 12px. Never body copy. See the `.pix` rule in globals.css.
const pixel = Silkscreen({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-pixel' });

const DESCRIPTION =
  'Corporate-action accounting for tokenized stocks on Solana. Corpact reads every balance-multiplier change, matches it to the issuer record, and books it as the action it actually was.';

export const metadata: Metadata = {
  metadataBase: new URL('https://corpact.example'),
  title: { default: 'Corpact: corporate-action accounting for tokenized stocks', template: '%s · Corpact Docs' },
  description: DESCRIPTION,
  openGraph: {
    title: 'Corpact: corporate-action accounting for tokenized stocks',
    description: DESCRIPTION,
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

// Runs before paint so a saved light theme never flashes dark. The attribute is always written, dark
// default included, so anything reading the theme off the DOM agrees with the page instead of falling
// back to the visitor's OS preference. `:root[data-theme='light']` is the only themed selector, so
// spelling out `dark` changes no styling.
const THEME_SCRIPT = `try{var t=localStorage.getItem('corpact-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark';}catch(e){document.documentElement.dataset.theme='dark';}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} ${pixel.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* The plate is the largest paint on the landing page and it is only 4 KB. */}
        <link rel="preload" as="image" href="/hero-pixels.png" fetchPriority="high" />
      </head>
      <body>{children}</body>
    </html>
  );
}
