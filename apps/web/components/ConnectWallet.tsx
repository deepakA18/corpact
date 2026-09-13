'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletConnection } from '@solana/react-hooks';

export function ConnectWallet() {
  const { connectors, connect, connected, connecting, wallet, isReady, status, error } = useWalletConnection();
  const router = useRouter();
  const address = wallet?.account.address;

  useEffect(() => {
    if (connected && address) router.push(`/wallet/${address}`);
  }, [connected, address, router]);

  if (!isReady) return <p className="muted">Looking for wallets…</p>;
  if (connectors.length === 0) {
    return <p className="muted">No Wallet Standard wallet was found in this browser.</p>;
  }
  return (
    <div className="stack">
      <div className="row">
        {connectors.map((c) => (
          <button key={c.id} onClick={() => void connect(c.id)} disabled={connecting}>
            {c.name}
          </button>
        ))}
      </div>
      {status === 'error' && <p className="error">Could not connect: {error instanceof Error ? error.message : String(error)}</p>}
    </div>
  );
}
