import { unstable_cache } from 'next/cache';
import { getPageTitle } from '@/lib/getPageTitles';
import GalleryClient from './GalleryClient';

// Page-scoped cache entry — see app/settings/page.js for the full rationale
// (getPageTitle has 12+ other call sites; only this page's own call site is
// cached/tagged, the shared function itself is untouched).
const getCachedGalleryPageTitle = unstable_cache(
  () => getPageTitle('gallery'),
  ['gallery-page-title'],
  { tags: ['gallery-page-title'], revalidate: 300 }
);

export default async function GalleryPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedGalleryPageTitle();
  return <GalleryClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
