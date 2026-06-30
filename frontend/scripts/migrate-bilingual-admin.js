/**
 * Migration: add bilingual English columns for admin-editable content.
 * Run once: node scripts/migrate-bilingual-admin.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Services table – English title
    await client.query(`
      ALTER TABLE services
        ADD COLUMN IF NOT EXISTS title_en VARCHAR(100)
    `);
    console.log('✓ services.title_en');

    // 2. Quest content blocks – English content
    await client.query(`
      ALTER TABLE quest_content_blocks
        ADD COLUMN IF NOT EXISTS content_en TEXT
    `);
    console.log('✓ quest_content_blocks.content_en');

    // 3. companies_config – add event_name_en stub if key exists
    await client.query(`
      UPDATE app_settings
      SET value = value || '{"event_name_en": ""}'::jsonb
      WHERE key = 'companies_config'
        AND NOT (value ? 'event_name_en')
    `);
    console.log('✓ companies_config.event_name_en (app_settings JSONB)');

    // 4. panels_config – add event_name_en stub if key exists
    await client.query(`
      UPDATE app_settings
      SET value = value || '{"event_name_en": ""}'::jsonb
      WHERE key = 'panels_config'
        AND NOT (value ? 'event_name_en')
    `);
    console.log('✓ panels_config.event_name_en (app_settings JSONB)');

    // 5. app_identity – add _en fields
    await client.query(`
      UPDATE app_settings
      SET value = value
        || '{"title_en": "", "short_name_en": "", "description_en": ""}'::jsonb
      WHERE key = 'app_identity'
        AND NOT (value ? 'title_en')
    `);
    console.log('✓ app_identity.*_en (app_settings JSONB)');

    // 6. login_page_settings – seed EN keys (same table, just extra rows)
    const EN_SEED = [
      ['title_en',              'IranPharma'],
      ['subtitle_en',           'Sign in to your account'],
      ['mobile_label_en',       'Mobile Number'],
      ['mobile_placeholder_en', '09xxxxxxxxx'],
      ['submit_button_text_en', 'Send Verification Code'],
      ['sending_text_en',       'Sending...'],
      ['otp_title_en',          'Enter Verification Code'],
      ['otp_subtitle_en',       'Code sent to'],
      ['otp_code_label_en',     '5-digit code'],
      ['verify_button_text_en', 'Verify'],
      ['verifying_text_en',     'Verifying...'],
      ['resend_otp_text_en',    'Resend Code'],
      ['edit_mobile_text_en',   'Change Email'],
    ];
    for (const [key, value] of EN_SEED) {
      await client.query(
        `INSERT INTO login_page_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }
    console.log('✓ login_page_settings _en keys');

    await client.query('COMMIT');
    console.log('\nAll migrations applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
