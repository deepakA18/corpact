'use client';

import { useEffect, useState } from 'react';
import type { Heading } from '@/lib/docs';

/** A heading counts as the current section once its top passes below the sticky top bar. */
const TOP_OFFSET = 120;

export function Toc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState(headings[0]?.id ?? '');

  useEffect(() => {
    const targets = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      // A short last section can never scroll up to the top bar, so the bottom of the page selects it.
      if (atBottom) {
        setActive(targets[targets.length - 1]!.id);
        return;
      }
      let current = targets[0]!.id;
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= TOP_OFFSET) current = target.id;
        else break;
      }
      setActive(current);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', schedule);
    };
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
              <a href={`#${h.id}`} className={active === h.id ? 'active' : ''} onClick={() => setActive(h.id)}>
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
