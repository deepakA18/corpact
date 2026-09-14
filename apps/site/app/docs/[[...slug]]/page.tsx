import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocArticle } from '@/components/DocArticle';
import { Prose } from '@/components/Prose';
import { getDoc } from '@/lib/docs';
import { ALL_ITEMS } from '@/lib/nav';

type Props = { params: Promise<{ slug?: string[] }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_ITEMS.filter((item) => item.slug !== 'api-reference').map((item) => ({ slug: item.slug ? item.slug.split('/') : [] }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug = [] } = await params;
  const doc = await getDoc(slug.join('/'));
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function DocRoute({ params }: Props) {
  const { slug = [] } = await params;
  const doc = await getDoc(slug.join('/'));
  if (!doc) notFound();
  return (
    <DocArticle slug={doc.slug} group={doc.group} title={doc.title} description={doc.description} headings={doc.headings}>
      <Prose html={doc.html} />
    </DocArticle>
  );
}
