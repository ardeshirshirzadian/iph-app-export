import { getCachedGalleryPageTitle } from '@/lib/pageTitleCache';
import GalleryClient from './GalleryClient';

export default async function GalleryPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedGalleryPageTitle();
  return <GalleryClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
