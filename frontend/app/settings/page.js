import { getPageTitle } from '@/lib/getPageTitles';
import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { title, subtitle, title_en, subtitle_en } = await getPageTitle('settings');
  return <SettingsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
