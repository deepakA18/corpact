import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Heading } from '@/lib/docs';
import { docHref, neighbours } from '@/lib/nav';
import { Icon } from './Icon';
import { Toc } from './Toc';

export function DocArticle({
  slug,
  group,
  title,
  description,
  headings,
  children,
}: {
  slug: string;
  group: string;
  title: string;
  description?: string;
  headings: Heading[];
  children: ReactNode;
}) {
  const { previous, next } = neighbours(slug);
  return (
    <div className="docs-content">
      <article className="doc-card">
        <p className="breadcrumb">
          {group} <span>/</span> <strong>{title}</strong>
        </p>
        <h1 className="doc-title">{title}</h1>
        {description && <p className="doc-lede">{description}</p>}
        {children}
        <nav className="doc-pager" aria-label="Previous and next pages">
          {previous ? (
            <Link href={docHref(previous.slug)} className="pager-link">
              <span>Previous</span>
              {previous.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={docHref(next.slug)} className="pager-link next">
              <span>
                Next <Icon name="arrow" size={14} />
              </span>
              {next.title}
            </Link>
          )}
        </nav>
      </article>
      <Toc headings={headings} />
    </div>
  );
}
