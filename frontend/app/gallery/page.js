import { getPageTitle } from '@/lib/getPageTitles';
import GalleryClient from './GalleryClient';

export const dynamic = 'force-dynamic';

export default async function GalleryPage() {
  const { title, subtitle, title_en, subtitle_en } = await getPageTitle('gallery');
  return <GalleryClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
