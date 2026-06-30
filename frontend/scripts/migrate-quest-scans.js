/**
 * Migration: add booth_uuid to companies + create quest_scans table.
 * Run once: node scripts/migrate-quest-scans.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS booth_uuid UUID DEFAULT gen_random_uuid()
    `);
    console.log('✓ companies.booth_uuid');

    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_scans (
        id         SERIAL PRIMARY KEY,
        user_uuid  VARCHAR(100) NOT NULL,
        company_id INT NOT NULL,
        booth_uuid UUID NOT NULL,
        scanned_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ quest_scans table');

    await client.query(`
      CREATE INDEX IF NOT EXISTS quest_scans_user_idx ON quest_scans(user_uuid)
    `);
    console.log('✓ quest_scans_user_idx');

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
