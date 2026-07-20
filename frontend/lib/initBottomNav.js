// Creates and seeds bottom_nav_items table on first use.
// Call ensureBottomNavTable() from any API route that reads bottom_nav_items.
import { query } from './db';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS bottom_nav_items (
    id SERIAL PRIMARY KEY,
    title_fa VARCHAR(100) NOT NULL,
    title_en VARCHAR(100),
    icon_type VARCHAR(10) NOT NULL DEFAULT 'upload',
    icon_path VARCHAR(500) NOT NULL,
    href VARCHAR(200) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  )
`;

// Use /logo/ paths — these are baked into the Docker image and always available.
// /uploads/nav/ only exists in the Docker volume for admin-uploaded custom icons.
const SEED = [
  {
    title_fa: 'خدمات',
    title_en: 'Services',
    icon_path: '/logo/services-icon.svg',
    href: '/',
    sort_order: 0,
  },
  {
    title_fa: 'کارت',
    title_en: 'Badge',
    icon_path: '/logo/id-badge.svg',
    href: '/badge',
    sort_order: 1,
  },
  {
    title_fa: 'پروفایل',
    title_en: 'Profile',
    icon_path: '/logo/user.svg',
    href: '/profile',
    sort_order: 2,
  },
];

export async function ensureBottomNavTable() {
  if (globalThis._bottomNavInitialized) return;

  await query(CREATE_TABLE);

  const { rows } = await query('SELECT COUNT(*)::int AS cnt FROM bottom_nav_items');
  if (rows[0].cnt === 0) {
    for (const item of SEED) {
      await query(
        `INSERT INTO bottom_nav_items (title_fa, title_en, icon_path, href, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [item.title_fa, item.title_en, item.icon_path, item.href, item.sort_order]
      );
    }
  } else {
    // Fix up rows seeded with /uploads/nav/ paths that don't exist in the Docker volume.
    // These WHERE conditions are idempotent — no-op once already corrected.
    await query(`UPDATE bottom_nav_items SET icon_path = '/logo/services-icon.svg' WHERE href = '/' AND icon_path = '/uploads/nav/services-icon.svg'`);
    await query(`UPDATE bottom_nav_items SET icon_path = '/logo/id-badge.svg'      WHERE href = '/badge' AND icon_path = '/uploads/nav/id-badge.svg'`);
    await query(`UPDATE bottom_nav_items SET icon_path = '/logo/user.svg'           WHERE href = '/profile' AND icon_path = '/uploads/nav/user.svg'`);
  }

  globalThis._bottomNavInitialized = true;
}
