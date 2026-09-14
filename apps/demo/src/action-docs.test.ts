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

  it('mark every page that is not validated, in the page and in the nav', () => {
    const files = renderActionDocs();
    const nav = files.get('apps/site/lib/actions-nav.generated.ts')!;
    for (const [path, content] of files) {
      if (!path.includes('/actions/')) continue;
      const status = /\| Validation status \| \*\*(.+?)\*\* \|/.exec(content)?.[1];
      expect(status, path).toBeDefined();
      if (status !== 'Validated') {
        expect(content, path).toMatch(/> \[!WARNING\] (Unvalidated|Not built)/);
        const slug = path.replace(/^.*\/actions\//, 'actions/').replace(/\.md$/, '');
        expect(nav).toMatch(new RegExp(`slug: '${slug}', badge: '${status}'`));
      }
    }
  });
});
