import { getPageTitle } from '@/lib/getPageTitles';
import MapClient from './MapClient';

export const dynamic = 'force-dynamic';

export default async function MapPage() {
  const { title, subtitle, title_en, subtitle_en } = await getPageTitle('map');
  return (
    <MapClient
      title={title}
      subtitle={subtitle}
      title_en={title_en}
      subtitle_en={subtitle_en}
    />
  );
}
