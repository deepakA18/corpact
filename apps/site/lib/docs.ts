import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import rehypeShiki from '@shikijs/rehype';
import matter from 'gray-matter';
import type { BundledLanguage } from 'shiki';
import type { Element, ElementContent, Root } from 'hast';
import { toString } from 'hast-util-to-string';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { ALL_ITEMS } from './nav';

export interface Heading {
  id: string;
  text: string;
  depth: 2 | 3;
}

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  group: string;
  html: string;
  headings: Heading[];
  /** Plain text, for search. */
  text: string;
}

export const CODE_THEMES = { light: 'github-light', dark: 'github-dark-default' } as const;
export const CODE_LANGS: BundledLanguage[] = ['bash', 'json', 'ts', 'tsx', 'sql', 'yaml', 'http'];

const CONTENT = join(process.cwd(), 'content/docs');
const CALLOUT_TITLES: Record<string, string> = { note: 'Note', tip: 'Tip', warning: 'Warning', important: 'Important' };

/** `> [!NOTE] Title` blockquotes become callouts. */
function rehypeCallouts() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'blockquote') return;
      const paragraph = node.children.find((c): c is Element => c.type === 'element' && c.tagName === 'p');
      const first = paragraph?.children[0];
      if (!paragraph || !first || first.type !== 'text') return;
      const [line = '', ...rest] = first.value.split('\n');
      const match = /^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*(.*)$/.exec(line);
      if (!match) return;
      const kind = match[1]!.toLowerCase();
      first.value = rest.join('\n');
      node.tagName = 'aside';
      node.properties = { className: ['callout', `callout-${kind}`] };
      const title: ElementContent = {
        type: 'element',
        tagName: 'p',
        properties: { className: ['callout-title'] },
        children: [{ type: 'text', value: match[2]!.trim() || CALLOUT_TITLES[kind]! }],
      };
      node.children.unshift(title);
    });
  };
}

/** Collect h2/h3 for the table of contents, then prefix each with an anchor link. */
function rehypeHeadings(out: Heading[]) {
  return () => (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'h2' && node.tagName !== 'h3') return;
      const id = String(node.properties?.id ?? '');
      out.push({ id, text: toString(node), depth: node.tagName === 'h2' ? 2 : 3 });
      node.children.unshift({ type: 'element', tagName: 'a', properties: { href: `#${id}`, className: ['anchor'], ariaHidden: 'true' }, children: [{ type: 'text', value: '#' }] });
    });
  };
}

const cache = new Map<string, Promise<DocPage | null>>();

export function getDoc(slug: string): Promise<DocPage | null> {
  let page = cache.get(slug);
  if (!page) {
    page = render(slug);
    cache.set(slug, page);
  }
  return page;
}

async function render(slug: string): Promise<DocPage | null> {
  const item = ALL_ITEMS.find((i) => i.slug === slug);
  const file = join(CONTENT, `${slug || 'index'}.md`);
  if (!item || !existsSync(file)) return null;
  const { content, data } = matter(readFileSync(file, 'utf8'));
  const headings: Heading[] = [];
  const html = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      // Pages use small blocks of HTML for card grids, step rails and code tabs; Markdown inside them still renders.
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeSlug)
      .use(rehypeCallouts)
      .use(rehypeHeadings(headings))
      .use(rehypeShiki, { themes: CODE_THEMES, defaultColor: false, langs: CODE_LANGS })
      .use(rehypeStringify)
      .process(content),
  );
  return {
    slug,
    title: String(data.title ?? item.title),
    description: String(data.description ?? ''),
    group: item.group,
    html,
    headings,
    text: content.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`|[\]()-]/g, ' ').replace(/\s+/g, ' ').trim(),
  };
}

export interface SearchEntry {
  title: string;
  group: string;
  href: string;
  section?: string;
  excerpt: string;
}

/** Page and section entries for client-side search. */
export async function searchIndex(): Promise<SearchEntry[]> {
  const entries: SearchEntry[] = [];
  for (const item of ALL_ITEMS) {
    const href = item.slug ? `/docs/${item.slug}` : '/docs';
    const doc = item.slug === 'api-reference' || item.slug === 'try-it' ? null : await getDoc(item.slug);
    entries.push({ title: item.title, group: item.group, href, excerpt: doc?.description || doc?.text.slice(0, 160) || 'Every endpoint, parameter and response.' });
    for (const h of doc?.headings ?? []) entries.push({ title: item.title, group: item.group, href: `${href}#${h.id}`, section: h.text, excerpt: '' });
  }
  return entries;
}
