import { unstable_cache } from 'next/cache';
import { getPageTitle } from '@/lib/getPageTitles';
import NewsClient from './NewsClient';

// Page-scoped cache entry — see app/settings/page.js for the full rationale.
const getCachedNewsPageTitle = unstable_cache(
  () => getPageTitle('news'),
  ['news-page-title'],
  { tags: ['news-page-title'], revalidate: 300 }
);

export default async function NewsPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedNewsPageTitle();
  return <NewsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
