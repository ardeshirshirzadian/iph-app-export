/**
 * Migration: add booth location fields to companies table, rasayesh_admin_token removed (domain whitelisted, no longer needed).
 * Run once: node scripts/migrate-booth-data.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS hall_name TEXT`);
    console.log('✓ companies.hall_name');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS booth_no TEXT`);
    console.log('✓ companies.booth_no');

    await client.query(`
      INSERT INTO app_settings (key, value)
      -- rasayesh_admin_token removed (no longer needed, domain is whitelisted)
      ON CONFLICT (key) DO NOTHING
    `);
    console.log('✓ app_settings.rasayesh_admin_token');

    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
