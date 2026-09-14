'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchEntry } from '@/lib/docs';
import { Icon } from './Icon';

function score(entry: SearchEntry, terms: string[]): number {
  const title = entry.title.toLowerCase();
  const section = entry.section?.toLowerCase() ?? '';
  const excerpt = entry.excerpt.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (section.includes(term)) total += 4;
    else if (title.includes(term)) total += 3;
    else if (excerpt.includes(term)) total += 1;
    else return 0;
  }
  return total + (entry.section ? 0 : 0.5);
}

export function Search({ index }: { index: SearchEntry[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return index.filter((e) => !e.section).slice(0, 8);
    return index
      .map((entry) => ({ entry, s: score(entry, terms) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 10)
      .map((r) => r.entry);
  }, [index, query]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button type="button" className="search-trigger" onClick={() => setOpen(true)}>
        <Icon name="search" size={18} />
        <span>Search documentation</span>
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="search-backdrop" onClick={() => setOpen(false)}>
          <div className="search-dialog" role="dialog" aria-label="Search documentation" onClick={(e) => e.stopPropagation()}>
            <div className="search-input">
              <Icon name="search" size={18} />
              <input
                ref={input}
                value={query}
                placeholder="Search guides, concepts, endpoints…"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, results.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === 'Enter' && results[active]) {
                    go(results[active].href);
                  }
                }}
              />
              <kbd>esc</kbd>
            </div>
            <ul className="search-results">
              {results.length === 0 && <li className="search-empty">No results for “{query}”</li>}
              {results.map((r, i) => (
                <li key={r.href}>
                  <Link href={r.href} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => setOpen(false)}>
                    <span className="search-group">{r.group}</span>
                    <span className="search-title">
                      {r.title}
                      {r.section && <span className="search-section"> › {r.section}</span>}
                    </span>
                    {r.excerpt && <span className="search-excerpt">{r.excerpt}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
