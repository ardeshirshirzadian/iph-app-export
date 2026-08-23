// Single source of truth for all admin panel sections.
// When adding a new /apn/[section] page:
//   1. Add one entry here — dashboard card, permission checkboxes, and route
//      protection all derive from this list automatically.
//   2. Register any /api/admin/[prefix] routes in API_SECTION_PREFIXES in proxy.js.
// Admins management (/apn/admins) is super-admin-only and NOT in this list.
export const ADMIN_SECTIONS = [
  {
    key: 'map-labels',
    label: 'برچسب‌های نقشه',
    path: '/apn/map-labels',
    icon: '🗺️',
    desc: 'ویرایش متون نقشه: پلاس‌هولدرها، عناوین و دکمه‌ها',
  },
];
