import { getCachedBadgePageConfig, getCachedBadgeHeaderIconConfig } from '@/lib/badgePageCache';
import { getCurrentEventId } from '@/lib/currentEvent';
import { resolveIconSyncEventId } from '@/lib/iconSyncConfig';
import BadgeClient from './BadgeClient';

export default async function BadgePage() {
  const eventId = await getCurrentEventId();
  // Icon-sync applies to the header icon only -- badge_page (title/subtitle
  // copy) is content, not icon config, and stays per-event.
  const iconEventId = await resolveIconSyncEventId(eventId);
  const [settings, headerIcon] = await Promise.all([
    getCachedBadgePageConfig(eventId),
    getCachedBadgeHeaderIconConfig(iconEventId),
  ]);

  return (
    <BadgeClient
      title={settings.title_fa}
      subtitle={settings.subtitle_fa}
      title_en={settings.title_en}
      subtitle_en={settings.subtitle_en}
      badgeSettings={settings}
      headerIcon={headerIcon}
    />
  );
}
