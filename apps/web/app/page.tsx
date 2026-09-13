import { AddressForm } from '../components/AddressForm';
import { ConnectWallet } from '../components/ConnectWallet';

export default function Home() {
  return (
    <div className="stack">
      <div>
        <h1>Corpact demo</h1>
        <p className="muted">
          xStocks pay dividends by quietly raising a balance multiplier. Corpact finds each of those changes on chain, matches
          it to the issuer&apos;s record, and accounts for what was income, what was a split, and what is still unexplained.
          This page is a reference client for the Corpact API.
        </p>
      </div>
      <section className="panel stack">
        <div>
          <strong>Connect a wallet</strong>
          <p className="muted">Read-only. The app only learns your address; it never asks you to sign anything.</p>
        </div>
        <ConnectWallet />
      </section>
      <section className="panel stack">
        <div>
          <strong>Or view a public address</strong>
          <p className="muted">All data shown is public on-chain history.</p>
        </div>
        <AddressForm />
      </section>
    </div>
  );
}
