import { getPageTitle } from '@/lib/getPageTitles';
import NotificationsClient from './NotificationsClient';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const { title, subtitle, title_en, subtitle_en } = await getPageTitle('notifications');
  return <NotificationsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
