/**
 * Seeds the services table with an Exhibition Book entry
 * and initializes book_config in app_settings.
 *
 * Run: node scripts/migrate-book-service.js
 */

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    // 1. Seed book_config into app_settings
    const bookConfig = {
      event_id: 18,
      book_id: 6,
      event_origin: 'https://2025.iphexpo.com',
      ipg_id: 1,
      is_enabled: true,
      title_fa: 'کتاب نمایشگاه',
      title_en: 'Exhibition Book',
      subtitle_fa: 'خرید کتاب نمایشگاه ایران فارما',
      subtitle_en: 'IranPharma Exhibition Book Purchase',
    };

    await client.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('book_config', $1)
       ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify(bookConfig)]
    );
    console.log('✓ book_config seeded into app_settings');

    // 2. Seed the Exhibition Book service entry (check for duplicate first)
    const existing = await client.query(
      `SELECT id FROM services WHERE link = '/book' LIMIT 1`
    );
    if (existing.rows.length > 0) {
      console.log('✓ Book service entry already exists, skipping insert');
    } else {
      await client.query(
        `INSERT INTO services (title, title_en, icon_type, icon_value, link, link_en,
           is_visible, is_visible_en, is_enabled, is_enabled_en, sort_order, icon_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        ['کتاب نمایشگاه', 'Exhibition Book', 'emoji', '📚', '/book', '/book',
          true, true, true, true, 6, 48]
      );
      console.log('✓ Exhibition Book service entry inserted into services table');
    }

    console.log('\nMigration complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
