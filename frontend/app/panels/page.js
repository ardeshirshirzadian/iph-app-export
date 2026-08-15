import { unstable_cache } from 'next/cache';
import { getPageTitle } from '@/lib/getPageTitles';
import PanelsClient from './PanelsClient';

// Page-scoped cache entry — see app/settings/page.js for the full rationale.
const getCachedPanelsPageTitle = unstable_cache(
  () => getPageTitle('panels'),
  ['panels-page-title'],
  { tags: ['panels-page-title'], revalidate: 300 }
);

export default async function PanelsPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedPanelsPageTitle();
  return <PanelsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
