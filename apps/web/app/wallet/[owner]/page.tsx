import { WalletLedger } from '../../../components/WalletLedger';

export default async function WalletPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner } = await params;
  return <WalletLedger owner={owner} />;
}
