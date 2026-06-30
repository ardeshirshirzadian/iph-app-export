/**
 * Migration: add sponsor fields to companies table.
 * Run once: node scripts/migrate-sponsor-fields.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_sponsor BOOLEAN DEFAULT false`);
    console.log('✓ companies.is_sponsor');

    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS sponsor_level VARCHAR(100)`);
    console.log('✓ companies.sponsor_level');

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
