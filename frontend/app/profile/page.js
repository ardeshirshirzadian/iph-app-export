import { getPageTitle } from '@/lib/getPageTitles';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getCachedProfileSupportLinkConfig } from '@/lib/profileSupportLinkCache';
import ProfileClient from './ProfileClient';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const eventId = await getCurrentEventId();
  const [{ title, subtitle, title_en, subtitle_en }, supportLink] = await Promise.all([
    getPageTitle('profile'),
    getCachedProfileSupportLinkConfig(eventId),
  ]);
  return (
    <ProfileClient
      title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en}
      supportLink={supportLink}
    />
  );
}
