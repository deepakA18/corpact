import Link from 'next/link';
import { searchIndex } from '@/lib/docs';
import { Icon } from './Icon';
import { Search } from './Search';
import { ThemeToggle } from './ThemeToggle';

export async function DocsTopbar() {
  const index = await searchIndex();
  return (
    <header className="docs-topbar">
      <Search index={index} />
      <Link href="/docs/api-reference" className="btn btn-accent btn-sm">
        <Icon name="reference" size={17} />
        API reference
      </Link>
      <div className="docs-topbar-end">
        <Link href="/docs/quickstart" className="btn btn-outline btn-sm">
          Get Started
          <Icon name="chevron" size={16} />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
