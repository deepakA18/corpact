'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAddress } from '@solana/kit';

export function AddressForm() {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const router = useRouter();

  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!isAddress(trimmed)) {
          setInvalid(true);
          return;
        }
        router.push(`/wallet/${trimmed}`);
      }}
    >
      <div style={{ flex: 1, minWidth: 260 }}>
        <input
          aria-label="Solana address"
          placeholder="Solana wallet address"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
        />
        {invalid && <p className="error">That is not a valid Solana address.</p>}
      </div>
      <button type="submit" className="primary">
        View ledger
      </button>
    </form>
  );
}
