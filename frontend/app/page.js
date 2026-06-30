import { query } from '@/lib/db';
import { getWelcomeToast } from '@/lib/getWelcomeToast';
import { getPushPrompt } from '@/lib/getPushPrompt';
import HomeClient from './components/HomeClient';

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

export default async function Home() {
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
