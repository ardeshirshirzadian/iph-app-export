import { query } from '@/lib/db';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS header_items (
    id         SERIAL PRIMARY KEY,
    item_type  VARCHAR(20) NOT NULL,
    title_fa   VARCHAR(100),
    title_en   VARCHAR(100),
    icon_path  VARCHAR(500),
    href       VARCHAR(200),
    is_active  BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    icon_size  INT NOT NULL DEFAULT 28
  )
`;

const SEED = [
  { item_type: 'profile_pic', sort_order: 0 },
  { item_type: 'logo',        sort_order: 1 },
  { item_type: 'bell',        sort_order: 2 },
  { item_type: 'cart',        sort_order: 3 },
  { item_type: 'settings',    sort_order: 4 },
];

export async function ensureHeaderItemsTable() {
  if (globalThis._headerItemsInitialized) return;
  await query(CREATE_TABLE);
  const { rows } = await query('SELECT COUNT(*)::int AS cnt FROM header_items');
  if (rows[0].cnt === 0) {
    for (const item of SEED) {
      await query(
        'INSERT INTO header_items (item_type, sort_order) VALUES ($1, $2)',
        [item.item_type, item.sort_order]
      );
    }
  } else {
    // Migrate: ensure profile_pic/settings rows exist in already-seeded tables
    const { rows: pp } = await query("SELECT id FROM header_items WHERE item_type = 'profile_pic'");
    if (pp.length === 0) {
      await query("INSERT INTO header_items (item_type, sort_order) VALUES ('profile_pic', 0)");
    }
    const { rows: st } = await query("SELECT id FROM header_items WHERE item_type = 'settings'");
    if (st.length === 0) {
      await query("INSERT INTO header_items (item_type, sort_order) VALUES ('settings', 4)");
    }
  }
  globalThis._headerItemsInitialized = true;
}
