import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getPageTitle } from '@/lib/getPageTitles';
import { getWelcomeToast } from '@/lib/getWelcomeToast';
import { getPushPrompt } from '@/lib/getPushPrompt';
import {
  getCachedQuestContentBlocks,
  getCachedQuestAppearanceConfig,
  getCachedQuestPageTitle,
  parseQuestBlocks,
} from '@/lib/questPageCache';
import { getCachedBadgePageConfig } from '@/lib/badgePageCache';
import {
  getCachedCompaniesPageTitle,
  getCachedPanelsPageTitle,
  getCachedMapPageTitle,
  getCachedChatPageTitle,
  getCachedGalleryPageTitle,
  getCachedNewsPageTitle,
} from '@/lib/pageTitleCache';
// HomeVariantRenderer is a "use client" dispatcher that next/dynamic()-imports
// whichever one of the 11 possible homepage variants `route` selects below —
// see that file for why the dynamic imports live there and not here.
import HomeVariantRenderer from './components/HomeVariantRenderer';

// ── Default home data fetchers ───────────────────────────────────────────────

async function getActiveServices(eventId) {
  try {
    const result = await query(
      'SELECT id, title, title_en, icon_type, icon_value, link, link_en, is_visible, is_enabled, is_visible_en, is_enabled_en, icon_size FROM services WHERE event_id = $1 AND (is_visible = true OR is_visible_en = true) ORDER BY sort_order ASC, id ASC',
      [eventId]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getActiveBanners(eventId) {
  try {
    const result = await query(
      'SELECT id, image_path, link, link_en, is_active, is_active_en FROM banners WHERE event_id = $1 AND (is_active = true OR is_active_en = true) ORDER BY sort_order ASC, id ASC',
      [eventId]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function getDefaultNotifications(eventId) {
  try {
    const result = await query(
      'SELECT id, icon, title FROM notifications WHERE event_id = $1 AND is_default = true ORDER BY created_at DESC LIMIT 5',
      [eventId]
    );
    return result.rows;
  } catch {
    return [];
  }
}

// All admin-curated content (services list, banner images, default-notification
// text, welcome-toast/push-prompt config) with no per-user or live state — see
// iph-apn's services/banners/notifications/welcome-toast/push-prompt save
// handlers for the matching revalidateTag() wiring. Same 300s fallback TTL
// convention as getCachedHomeContentRoute above.
const getCachedActiveServices = unstable_cache(getActiveServices, ['home-active-services'], {
  tags: ['home-active-services'],
  revalidate: 300,
});
const getCachedActiveBanners = unstable_cache(getActiveBanners, ['home-active-banners'], {
  tags: ['home-active-banners'],
  revalidate: 300,
});
const getCachedDefaultNotifications = unstable_cache(getDefaultNotifications, ['home-default-notifications'], {
  tags: ['home-default-notifications'],
  revalidate: 300,
});
const getCachedWelcomeToast = unstable_cache(getWelcomeToast, ['home-welcome-toast'], {
  tags: ['home-welcome-toast'],
  revalidate: 300,
});
const getCachedPushPrompt = unstable_cache(getPushPrompt, ['home-push-prompt'], {
  tags: ['home-push-prompt'],
  revalidate: 300,
});

// ── Config reader ────────────────────────────────────────────────────────────

// Which variant is "home" is a significant admin action (e.g. switching home
// from Quest to Map during an event) and must reflect promptly — see the
// on-demand revalidateTag() call wired into iph-apn's home-page save handler.
// 300s is a safety-net ceiling only, same pattern as app/settings/page.js.
const getCachedHomeContentRoute = unstable_cache(
  async (eventId) => {
    try {
      const result = await query(
        "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'home_page_config'",
        [eventId]
      );
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
  const currentEventId = await getCurrentEventId();
  const route = await getCachedHomeContentRoute(currentEventId);

  // Each case replicates the exact server-side logic from its own page.js,
  // then renders that page's Client Component directly. The URL stays "/".

  switch (route) {
    case '/quest': {
      let content = { main: {}, main_en: {}, missions: [], leaderboard: [], badges: [] };
      try {
        const rows = await getCachedQuestContentBlocks(currentEventId);
        content = parseQuestBlocks(rows);
      } catch (err) {
        console.error('[home→quest] failed to load content blocks:', err.message);
      }
      let appearanceConfig = {};
      try {
        appearanceConfig = await getCachedQuestAppearanceConfig(currentEventId);
      } catch {
        // Fall back to defaults in QuestClient
      }
      const { title, subtitle, title_en, subtitle_en } = await getCachedQuestPageTitle(currentEventId);
      return <HomeVariantRenderer route="/quest" content={content} title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} appearanceConfig={appearanceConfig} isHomeContext={true} />;
    }

    case '/companies': {
      const { title, subtitle, title_en, subtitle_en } = await getCachedCompaniesPageTitle(currentEventId);
      return <HomeVariantRenderer route="/companies" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/panels': {
      const { title, subtitle, title_en, subtitle_en } = await getCachedPanelsPageTitle(currentEventId);
      return <HomeVariantRenderer route="/panels" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/badge': {
      const settings = await getCachedBadgePageConfig(currentEventId);
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
      const { title, subtitle, title_en, subtitle_en } = await getCachedMapPageTitle(currentEventId);
      return <HomeVariantRenderer route="/map" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/chat': {
      const { title, subtitle, title_en, subtitle_en } = await getCachedChatPageTitle(currentEventId);
      return <HomeVariantRenderer route="/chat" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/notifications': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('notifications', currentEventId);
      return <HomeVariantRenderer route="/notifications" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/gallery': {
      const { title, subtitle, title_en, subtitle_en } = await getCachedGalleryPageTitle(currentEventId);
      return <HomeVariantRenderer route="/gallery" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/news': {
      const { title, subtitle, title_en, subtitle_en } = await getCachedNewsPageTitle(currentEventId);
      return <HomeVariantRenderer route="/news" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/profile': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('profile', currentEventId);
      return <HomeVariantRenderer route="/profile" title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    default: {
      // Default (empty setting): render the services grid exactly as before.
      const [services, banners, defaultNotifications, welcomeToast, pushPrompt] = await Promise.all([
        getCachedActiveServices(currentEventId),
        getCachedActiveBanners(currentEventId),
        getCachedDefaultNotifications(currentEventId),
        getCachedWelcomeToast(currentEventId),
        getCachedPushPrompt(currentEventId),
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
