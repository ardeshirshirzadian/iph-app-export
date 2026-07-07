import { getPageTitle } from '@/lib/getPageTitles';
import NewsClient from './NewsClient';

export const dynamic = 'force-dynamic';

export default async function NewsPage() {
  const { title, subtitle, title_en, subtitle_en } = await getPageTitle('news');
  return <NewsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
