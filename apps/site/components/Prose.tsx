'use client';

import { useEffect, useRef } from 'react';

/** Rendered Markdown, with a copy button added to every code block. */
export function Prose({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
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
