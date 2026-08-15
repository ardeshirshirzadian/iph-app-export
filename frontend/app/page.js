import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getPageTitle } from '@/lib/getPageTitles';
import { getWelcomeToast } from '@/lib/getWelcomeToast';
import { getPushPrompt } from '@/lib/getPushPrompt';
import { ensureQuestContentTable } from '@/lib/initQuestContent';
// HomeVariantRenderer is a "use client" dispatcher that next/dynamic()-imports
// whichever one of the 11 possible homepage variants `route` selects below —
// see that file for why the dynamic imports live there and not here.
import HomeVariantRenderer from './components/HomeVariantRenderer';

export const dynamic = 'force-dynamic';

// ── Default home data fetchers ───────────────────────────────────────────────

async function getActiveServices() {
  try {
    const result = await query(
      'SELECT id, title, title_en, icon_type, icon_value, link, link_en, is_visible, is_enabled, is_visible_en, is_enabled_en, icon_size FROM services WHERE (is_visible = true OR is_visible_en = true) ORDER BY sort_order ASC, id ASC'
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getActiveBanners() {
  try {
    const result = await query(
      'SELECT id, image_path, link, link_en, is_active, is_active_en FROM banners WHERE is_active = true OR is_active_en = true ORDER BY sort_order ASC, id ASC'
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getDefaultNotifications() {
  try {
    const result = await query(
      'SELECT id, icon, title FROM notifications WHERE is_default = true ORDER BY created_at DESC LIMIT 5'
    );
    return result.rows;
  } catch {
    return [];
  }
}

// ── Quest content parser (mirrors quest/page.js) ─────────────────────────────

function parseQuestBlocks(rows) {
  const main = {};
  const main_en = {};
  const missions = [];
  const leaderboard = [];
  const badges = [];

  for (const row of rows) {
    if (row.section === 'main') {
      if (row.block_key.startsWith('icon_')) {
        try {
          const p = JSON.parse(row.content);
          if (typeof p === 'object' && p !== null) { main[row.block_key] = p; continue; }
        } catch {}
      }
      main[row.block_key] = row.content;
      if (row.content_en) main_en[row.block_key] = row.content_en;
    } else {
      let parsed;
      try { parsed = JSON.parse(row.content); } catch { continue; }
      const entry = { id: row.id, block_key: row.block_key, sort_order: row.sort_order, ...parsed };
      if (row.section === 'missions')    missions.push(entry);
      if (row.section === 'leaderboard') leaderboard.push(entry);
      if (row.section === 'badges')      badges.push(entry);
    }
  }

  return { main, main_en, missions, leaderboard, badges };
}

// ── Badge defaults (mirrors badge/page.js) ───────────────────────────────────

const BADGE_DEFAULTS = {
  title_fa: 'کارت بازدیدکننده',
  title_en: 'Visitor Badge',
  subtitle_fa: 'اطلاعات شما در نمایشگاه',
  subtitle_en: 'Your Exhibition Information',
  event_name_fa: 'یازدهمین نمایشگاه ایران فارما ۱۴۰۵',
  event_name_en: '11th IranPharma Exhibition 2025',
  logo_icon_type: 'image',
  logo_icon_value: '/logo/logo-l.png',
  logo_icon_size: 64,
};

// ── Config reader ────────────────────────────────────────────────────────────

// Which variant is "home" is a significant admin action (e.g. switching home
// from Quest to Map during an event) and must reflect promptly — see the
// on-demand revalidateTag() call wired into iph-apn's home-page save handler.
// 300s is a safety-net ceiling only, same pattern as app/settings/page.js.
const getCachedHomeContentRoute = unstable_cache(
  async () => {
    try {
      const result = await query("SELECT value FROM app_settings WHERE key = 'home_page_config'");
      return result.rows[0]?.value?.redirect_path || '';
    } catch {
      return '';
    }
  },
  ['home-page-config'],
  { tags: ['home-page-config'], revalidate: 300 }
);

// ── Page component ───────────────────────────────────────────────────────────

export default async function Home() {
  const route = await getCachedHomeContentRoute();

  // Each case replicates the exact server-side logic from its own page.js,
  // then renders that page's Client Component directly. The URL stays "/".

  switch (route) {
    case '/quest': {
      let content = { main: {}, main_en: {}, missions: [], leaderboard: [], badges: [] };
      try {
        await ensureQuestContentTable();
        const result = await query(
          'SELECT * FROM quest_content_blocks ORDER BY section, sort_order ASC, id ASC'
        );
        content = parseQuestBlocks(result.rows);
      } catch (err) {
        console.error('[home→quest] failed to load content blocks:', err.message);
      }
      let appearanceConfig = {};
      try {
        const appResult = await query(
          "SELECT value FROM app_settings WHERE key = 'quest_appearance_config'"
        );
        appearanceConfig = appResult.rows[0]?.value ?? {};
      } catch {
        // Fall back to defaults in QuestClient
      }
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('quest');
      return <HomeVariantRenderer route="/quest" content={content} title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} appearanceConfig={appearanceConfig} isHomeContext={true} />;
    }

    case '/companies': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('companies');
      return <HomeVariantRenderer route="/companies" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/panels': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('panels');
      return <HomeVariantRenderer route="/panels" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/badge': {
      let settings = BADGE_DEFAULTS;
      try {
        const result = await query("SELECT value FROM app_settings WHERE key = 'badge_page'");
        if (result.rows[0]?.value) settings = { ...BADGE_DEFAULTS, ...result.rows[0].value };
      } catch {
        // fall back to defaults
      }
      return (
        <HomeVariantRenderer
          route="/badge"
          title={settings.title_fa}
          subtitle={settings.subtitle_fa}
          title_en={settings.title_en}
          subtitle_en={settings.subtitle_en}
          badgeSettings={settings}
          isHomeContext={true}
        />
      );
    }

    case '/map': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('map');
      return <HomeVariantRenderer route="/map" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/chat': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('chat');
      return <HomeVariantRenderer route="/chat" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/notifications': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('notifications');
      return <HomeVariantRenderer route="/notifications" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/gallery': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('gallery');
      return <HomeVariantRenderer route="/gallery" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/news': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('news');
      return <HomeVariantRenderer route="/news" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/profile': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('profile');
      return <HomeVariantRenderer route="/profile" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    default: {
      // Default (empty setting): render the services grid exactly as before.
      const [services, banners, defaultNotifications, welcomeToast, pushPrompt] = await Promise.all([
        getActiveServices(),
        getActiveBanners(),
        getDefaultNotifications(),
        getWelcomeToast(),
        getPushPrompt(),
      ]);
      return (
        <HomeVariantRenderer
          route=""
          services={services}
          banners={banners}
          defaultNotifications={defaultNotifications}
          welcomeToast={welcomeToast}
          pushPrompt={pushPrompt}
        />
      );
    }
  }
}
