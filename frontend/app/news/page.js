import { getCachedNewsPageTitle } from '@/lib/pageTitleCache';
import NewsClient from './NewsClient';

export default async function NewsPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedNewsPageTitle();
  return <NewsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
