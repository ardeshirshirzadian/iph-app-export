import { unstable_cache } from 'next/cache';
import { getPageTitle } from '@/lib/getPageTitles';
import MapClient from './MapClient';

// Page-scoped cache entry — see app/settings/page.js for the full rationale.
const getCachedMapPageTitle = unstable_cache(
  () => getPageTitle('map'),
  ['map-page-title'],
  { tags: ['map-page-title'], revalidate: 300 }
);

export default async function MapPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedMapPageTitle();
  return (
    <MapClient
      title={title}
      subtitle={subtitle}
      title_en={title_en}
      subtitle_en={subtitle_en}
    />
  );
}
