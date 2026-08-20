import { getCachedBadgePageConfig } from '@/lib/badgePageCache';
import { getCurrentEventId } from '@/lib/currentEvent';
import BadgeClient from './BadgeClient';

export default async function BadgePage() {
  const settings = await getCachedBadgePageConfig(await getCurrentEventId());

  return (
    <BadgeClient
      title={settings.title_fa}
      subtitle={settings.subtitle_fa}
      title_en={settings.title_en}
      subtitle_en={settings.subtitle_en}
      badgeSettings={settings}
    />
  );
}
