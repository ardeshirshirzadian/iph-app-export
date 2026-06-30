/**
 * Seeds the services table with a Registration entry
 * and initializes registration_config in app_settings.
 *
 * Run: node scripts/migrate-registration-service.js
 */

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    // 1. Seed registration_config into app_settings
    const registrationConfig = {
      event_id: 18,
      event_origin: 'https://2025.iphexpo.com',
      is_enabled: false,
      title_fa: 'ثبت‌نام رویداد',
      title_en: 'Event Registration',
      subtitle_fa: 'پکیج مورد نظر خود را انتخاب کنید',
      subtitle_en: 'Select your registration package',
    };

    await client.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('registration_config', $1)
       ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify(registrationConfig)]
    );
    console.log('✓ registration_config seeded into app_settings');

    // 2. Seed the Registration service entry (check for duplicate first)
    const existing = await client.query(
      `SELECT id FROM services WHERE link = '/register' LIMIT 1`
    );
    if (existing.rows.length > 0) {
      console.log('✓ Registration service entry already exists, skipping insert');
    } else {
      await client.query(
        `INSERT INTO services (title, title_en, icon_type, icon_value, link, link_en,
           is_visible, is_visible_en, is_enabled, is_enabled_en, sort_order, icon_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        ['ثبت‌نام', 'Register', 'emoji', '📋', '/register', '/register',
          true, true, true, true, 2, 48]
      );
      console.log('✓ Registration service entry inserted into services table');
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
