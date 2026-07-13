#!/usr/bin/env node
// One-time migration: create map_elements table.
// Run: node scripts/migrate-map-elements.js

const fs = require('fs');
const envPath = require('path').join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS map_elements (
        id SERIAL PRIMARY KEY,
        title_fa VARCHAR(200) NOT NULL,
        title_en VARCHAR(200),
        icon_type VARCHAR(10) NOT NULL DEFAULT 'preset',
        icon_value VARCHAR(500),
        color VARCHAR(20) DEFAULT '#3b82f6',
        x FLOAT NOT NULL DEFAULT 0,
        y FLOAT NOT NULL DEFAULT 0,
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ map_elements table ready');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
