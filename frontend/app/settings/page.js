import { getPageTitle } from '@/lib/getPageTitles';
import { getThemeMode } from '@/lib/getThemeMode';
import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [{ title, subtitle, title_en, subtitle_en }, themeMode] = await Promise.all([
    getPageTitle('settings'),
    getThemeMode(),
  ]);
  return <SettingsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} themeMode={themeMode} />;
}
