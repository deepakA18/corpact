import { Dashboard } from '../../../components/Dashboard';

export default async function WalletPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner } = await params;
  return <Dashboard owner={owner} />;
}
