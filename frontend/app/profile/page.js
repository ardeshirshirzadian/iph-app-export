import { getPageTitle } from '@/lib/getPageTitles';
import ProfileClient from './ProfileClient';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const { title, subtitle, title_en, subtitle_en } = await getPageTitle('profile');
  return <ProfileClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
