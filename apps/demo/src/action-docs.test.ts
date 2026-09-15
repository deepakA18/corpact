import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderActionDocs } from './action-docs';
import { REPO_ROOT } from './runner';

describe('per-action docs pages', () => {
  it('match the taxonomy: regenerate with `pnpm --filter @corpact/demo action-docs` when this fails', () => {
    for (const [path, content] of renderActionDocs()) {
      const file = join(REPO_ROOT, path);
      expect(existsSync(file), `${path} is missing`).toBe(true);
      expect(readFileSync(file, 'utf8'), `${path} is stale`).toBe(content);
    }
  });

  it('state on every page whether the type is booked automatically, in neutral wording and with no badges', () => {
    const files = renderActionDocs();
    for (const [path, content] of files) {
      expect(content, path).not.toMatch(/unvalidated|not built|badge:/i);
      if (!path.includes('/actions/')) continue;
      expect(content, path).toMatch(/\| Automatic booking \| \*\*(Yes|Held for review)\*\* \|/);
    }
  });
});
