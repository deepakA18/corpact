import type { ReactNode } from 'react';
import { DocsTopbar } from '@/components/DocsTopbar';
import { Sidebar } from '@/components/Sidebar';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs-shell">
      <Sidebar />
      <div className="docs-main">
        <DocsTopbar />
        {children}
      </div>
    </div>
  );
}
