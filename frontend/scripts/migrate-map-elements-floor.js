#!/usr/bin/env node
// Migration: add floor + linked_element_id columns to map_elements.
// Run: node scripts/migrate-map-elements-floor.js

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
      ALTER TABLE map_elements
        ADD COLUMN IF NOT EXISTS floor INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS linked_element_id INT REFERENCES map_elements(id) ON DELETE SET NULL
    `);
    console.log('✅ map_elements: floor + linked_element_id columns added');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
