'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { NAV, docHref } from '@/lib/nav';
import { Icon } from './Icon';
import { Logo } from './Logo';

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button type="button" className="sidebar-toggle" aria-label="Open navigation" onClick={() => setMobileOpen((v) => !v)}>
        <Icon name="menu" />
      </button>
      <nav className={`sidebar ${mobileOpen ? 'open' : ''}`} aria-label="Documentation">
        <div className="sidebar-brand">
          <Logo suffix="Docs" />
        </div>
        <Link href="/" className={`sidebar-home ${pathname === '/' ? 'active' : ''}`}>
          <Icon name="home" />
          <span>Home</span>
        </Link>
        {NAV.map((group) => {
          // A folded group unfolds itself when it holds the current page, so the sidebar always shows
          // where you are; an explicit click on the header wins over that from then on.
          const holdsCurrent = group.items.some((item) => docHref(item.slug) === pathname);
          const isCollapsed = collapsed[group.title] ?? (group.defaultCollapsed === true && !holdsCurrent);
          return (
            <div className="sidebar-group" key={group.title}>
              <button
                type="button"
                className="sidebar-group-title"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((c) => ({ ...c, [group.title]: !isCollapsed }))}
              >
                <Icon name={group.icon} />
                <span>{group.title}</span>
                <Icon name="down" size={16} className={`caret ${isCollapsed ? 'closed' : ''}`} />
              </button>
              {!isCollapsed && (
                <ul>
                  {group.items.map((item) => {
                    const href = docHref(item.slug);
                    const active = pathname === href;
                    return (
                      <li key={item.slug}>
                        <Link href={href} className={active ? 'active' : ''} onClick={() => setMobileOpen(false)}>
                          {item.title}
                          {item.badge && <span className="badge">{item.badge}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );
}
