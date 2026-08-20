import { unstable_cache } from 'next/cache';
import { getPageTitle } from '@/lib/getPageTitles';
import { getThemeMode } from '@/lib/getThemeMode';
import { getCurrentEventId } from '@/lib/currentEvent';
import SettingsClient from './SettingsClient';

// getPageTitle/getThemeMode are shared helpers called by many other
// still-force-dynamic pages (getPageTitle: 12+ other pages; getThemeMode:
// the root layout, on every route). Wrapping THOSE functions directly would
// silently change every other page's freshness behavior. Instead, these are
// page-scoped cache entries — only this page's own call site is cached, and
// only these two tags can invalidate it. 300s is a safety-net ceiling, not
// the primary invalidation path — see app/api/internal/revalidate/route.js
// for the on-demand revalidateTag() call that's meant to do the real work.
const getCachedSettingsPageTitle = unstable_cache(
  (eventId) => getPageTitle('settings', eventId),
  ['settings-page-title'],
  { tags: ['settings-page-title'], revalidate: 300 }
);

const getCachedSettingsThemeMode = unstable_cache(
  (eventId) => getThemeMode(eventId),
  ['settings-theme-mode'],
  { tags: ['settings-theme-mode'], revalidate: 300 }
);

export default async function SettingsPage() {
  const currentEventId = await getCurrentEventId();
  const [{ title, subtitle, title_en, subtitle_en }, themeMode] = await Promise.all([
    getCachedSettingsPageTitle(currentEventId),
    getCachedSettingsThemeMode(currentEventId),
  ]);
  return <SettingsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} themeMode={themeMode} />;
}
