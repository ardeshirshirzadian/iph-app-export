import { getCachedMapPageTitle } from '@/lib/pageTitleCache';
import { getCurrentEventId } from '@/lib/currentEvent';
import MapClient from './MapClient';

export default async function MapPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedMapPageTitle(await getCurrentEventId());
  return (
    <MapClient
      title={title}
      subtitle={subtitle}
      title_en={title_en}
      subtitle_en={subtitle_en}
    />
  );
}
