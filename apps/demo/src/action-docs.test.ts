import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_KINDS, ACTION_KIND_SPECS } from '@corpact/domain';
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

  it('publish a page only for types Corpact books, with no status labels or instance counts', () => {
    const files = renderActionDocs();
    const pages = [...files.keys()].filter((path) => path.includes('/actions/'));
    const published = ACTION_KINDS.filter((kind) => ACTION_KIND_SPECS[kind].classifier === 'validated');
    expect(pages).toHaveLength(published.length);
    for (const kind of published) expect(pages.some((p) => p.endsWith(`${kind.replaceAll('_', '-')}.md`)), kind).toBe(true);
    for (const [path, content] of files) {
      expect(content, path).not.toMatch(/unvalidated|not built|held for review|badge:|Real instances/i);
    }
  });
});
