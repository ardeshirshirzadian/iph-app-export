import AdminPageHeader from '@/components/AdminPageHeader';
import MapLabelsClient from './MapLabelsClient';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const DEFAULTS = {
  search_placeholder_fa: 'جستجوی غرفه یا شرکت...',
  search_placeholder_en: 'Search booth or company...',
  set_destination_fa: 'تنظیم به‌عنوان مقصد',
  set_destination_en: 'Set as destination',
  origin_panel_title_fa: 'نقطه شروع را انتخاب کنید',
  origin_panel_title_en: 'Where are you starting from?',
  origin_search_placeholder_fa: 'جستجو...',
  origin_search_placeholder_en: 'Search...',
};

export default async function MapLabelsPage() {
  let saved = {};
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'map_labels_config'");
    saved = result.rows[0]?.value ?? {};
  } catch { /* fall back to defaults */ }

  const config = { ...DEFAULTS, ...saved };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <AdminPageHeader
        title="برچسب‌های نقشه"
        subtitle="ویرایش متون نقشه: پلاس‌هولدرها، عناوین و دکمه‌ها (فارسی و انگلیسی)"
        backHref="/apn"
      />
      <MapLabelsClient initialConfig={config} />
    </div>
  );
}
