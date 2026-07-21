import { query } from '@/lib/db';
import { getPageTitle } from '@/lib/getPageTitles';
import { getWelcomeToast } from '@/lib/getWelcomeToast';
import { getPushPrompt } from '@/lib/getPushPrompt';
import { ensureQuestContentTable } from '@/lib/initQuestContent';

// Default home
import HomeClient from './components/HomeClient';

// Aliasable page clients
import QuestClient from './quest/QuestClient';
import CompaniesClient from './companies/CompaniesClient';
import PanelsClient from './panels/PanelsClient';
import BadgeClient from './badge/BadgeClient';
import MapClient from './map/MapClient';
import ChatClient from './chat/ChatClient';
import NotificationsClient from './notifications/NotificationsClient';
import GalleryClient from './gallery/GalleryClient';
import NewsClient from './news/NewsClient';
import ProfileClient from './profile/ProfileClient';

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
  show_qr: true,
  show_company: true,
  show_job_title: true,
  show_national_id: false,
};

// ── Config reader ────────────────────────────────────────────────────────────

async function getHomeContentRoute() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'home_page_config'");
    return result.rows[0]?.value?.redirect_path || '';
  } catch {
    return '';
  }
}

// ── Page component ───────────────────────────────────────────────────────────

export default async function Home() {
  const route = await getHomeContentRoute();

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
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('quest');
      return <QuestClient content={content} title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/companies': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('companies');
      return <CompaniesClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/panels': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('panels');
      return <PanelsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
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
        <BadgeClient
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
      return <MapClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/chat': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('chat');
      return <ChatClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/notifications': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('notifications');
      return <NotificationsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/gallery': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('gallery');
      return <GalleryClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/news': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('news');
      return <NewsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
    }

    case '/profile': {
      const { title, subtitle, title_en, subtitle_en } = await getPageTitle('profile');
      return <ProfileClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={true} />;
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
        <HomeClient
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
