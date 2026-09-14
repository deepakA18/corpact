'use client';

import { useEffect, useState } from 'react';
import type { Heading } from '@/lib/docs';

export function Toc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState(headings[0]?.id ?? '');

  useEffect(() => {
    const targets = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -65% 0px' },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;
  let h2 = 0;
  let h3 = 0;
  return (
    <aside className="toc" aria-label="On this page">
      <p className="toc-title">Table of Contents</p>
      <ul>
        {headings.map((h) => {
          if (h.depth === 2) {
            h2 += 1;
            h3 = 0;
          } else h3 += 1;
          return (
            <li key={h.id} className={`depth-${h.depth}`}>
              <a href={`#${h.id}`} className={active === h.id ? 'active' : ''}>
                {h.depth === 3 ? `${h3}. ` : ''}
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
