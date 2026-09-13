'use client';

import type { ReactNode } from 'react';
import { autoDiscover, createClient } from '@solana/client';
import { SolanaProvider } from '@solana/react-hooks';

const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

// One client for the app. The wallet is used only to learn its address — nothing is ever signed.
const solanaClient = createClient({
  endpoint,
  websocketEndpoint: process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? endpoint.replace('https://', 'wss://').replace('http://', 'ws://'),
  walletConnectors: autoDiscover(),
});

export function Providers({ children }: { children: ReactNode }) {
  return <SolanaProvider client={solanaClient}>{children}</SolanaProvider>;
}
