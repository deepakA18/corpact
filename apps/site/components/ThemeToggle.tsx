'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

type Theme = 'dark' | 'light';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('corpact-theme', next);
    } catch {
      // Private windows can refuse storage; the theme still applies for this visit.
    }
  };

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      <button type="button" aria-pressed={theme === 'dark'} aria-label="Dark theme" onClick={() => choose('dark')}>
        <Icon name="moon" size={17} />
      </button>
      <button type="button" aria-pressed={theme === 'light'} aria-label="Light theme" onClick={() => choose('light')}>
        <Icon name="sun" size={17} />
      </button>
    </div>
  );
}
