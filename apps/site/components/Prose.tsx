'use client';

import { useEffect, useRef } from 'react';

/** Rendered Markdown, with a copy button added to every code block. */
export function Prose({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    // Pages can group alternatives (curl, TypeScript) in one block; build the tab strip for each group.
    for (const group of root.querySelectorAll('.code-tabs')) {
      if (group.querySelector('.code-tabs-bar')) continue;
      const tabs = [...group.querySelectorAll<HTMLElement>('.code-tab')];
      if (tabs.length === 0) continue;
      const bar = document.createElement('div');
      bar.className = 'code-tabs-bar';
      const buttons = tabs.map((tab, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = tab.dataset.label ?? `Tab ${index + 1}`;
        button.addEventListener('click', () => {
          tabs.forEach((t, i) => t.classList.toggle('active', i === index));
          buttons.forEach((b, i) => b.classList.toggle('active', i === index));
        });
        bar.append(button);
        tab.classList.toggle('active', index === 0);
        return button;
      });
      buttons[0]?.classList.add('active');
      group.prepend(bar);
    }

    for (const pre of root.querySelectorAll('pre')) {
      if (pre.parentElement?.classList.contains('code-frame')) continue;
      const frame = document.createElement('div');
      frame.className = 'code-frame';
      pre.replaceWith(frame);
      frame.append(pre);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(pre.innerText);
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Press ⌘C';
        }
        setTimeout(() => (button.textContent = 'Copy'), 1500);
      });
      frame.append(button);
    }
  }, [html]);

  return <div ref={ref} className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
