/**
 * Migration: add detail fields to companies table for per-company detail pages.
 * Run once: node scripts/migrate-companies-detail.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS slug VARCHAR(255)`);
    console.log('✓ companies.slug');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS phones JSONB`);
    console.log('✓ companies.phones');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS emails JSONB`);
    console.log('✓ companies.emails');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_fa TEXT`);
    console.log('✓ companies.address_fa');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_en TEXT`);
    console.log('✓ companies.address_en');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS industry_id INT`);
    console.log('✓ companies.industry_id');

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
