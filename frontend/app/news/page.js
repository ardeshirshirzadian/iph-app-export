import { getCachedNewsPageTitle } from '@/lib/pageTitleCache';
import { getCurrentEventId } from '@/lib/currentEvent';
import NewsClient from './NewsClient';

export default async function NewsPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedNewsPageTitle(await getCurrentEventId());
  return <NewsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
