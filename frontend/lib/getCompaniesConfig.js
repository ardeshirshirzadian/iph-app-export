import 'server-only';
import { unstable_cache } from 'next/cache';
import { query } from './db';

const DEFAULT_CONFIG = {
  eventId: null,
  logoBaseUrl: '',
  eventOrigin: 'https://2025.iphexpo.com',
  visibleFields: {},
  visibleFieldsEn: {},
  eventName: '',
  eventNameEn: '',
};

export async function getCompaniesConfig() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'companies_config'");
    const config = result.rows[0]?.value ?? {};
    return {
      eventId: config.event_id ?? null,
      logoBaseUrl: config.logo_base_url ?? '',
      eventOrigin: config.event_origin ?? DEFAULT_CONFIG.eventOrigin,
      visibleFields: config.visible_fields ?? {},
      visibleFieldsEn: config.visible_fields_en ?? {},
      eventName: config.event_name ?? '',
      eventNameEn: config.event_name_en ?? '',
    };
  } catch (error) {
    console.error('getCompaniesConfig error:', error);
    return DEFAULT_CONFIG;
  }
}

// Admin-editable-only (iph-apn PUT /api/admin/companies/settings) -- tag-based
// on-demand revalidation via app/api/internal/revalidate, 300s fallback.
// Shared by app/api/companies/config/route.js AND app/api/companies/data/route.js
// (the latter needs eventId/eventOrigin/logoBaseUrl to call Rasayesh) so both
// read through the SAME cache entry instead of hitting the DB independently.
export const getCachedCompaniesConfig = unstable_cache(
  () => getCompaniesConfig(),
  ['companies-config'],
  { tags: ['companies-config'], revalidate: 300 }
);
