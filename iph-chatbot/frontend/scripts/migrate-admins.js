#!/usr/bin/env node
// One-time migration: create admins table and seed initial super admin.
// Run: node scripts/migrate-admins.js

// Load .env.local manually without dotenv dependency
const fs = require('fs');
const envPath = require('path').join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(100),
        permissions JSONB NOT NULL DEFAULT '[]',
        is_super_admin BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login_at TIMESTAMP
      )
    `);
    console.log('Table created (or already exists).');

    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password) {
      throw new Error('ADMIN_USERNAME / ADMIN_PASSWORD missing from .env.local');
    }

    const existing = await client.query('SELECT id FROM admins WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      console.log(`Admin "${username}" already exists — skipping seed.`);
      return;
    }

    const allPermissions = ['chatbot', 'appearance', 'services', 'quest', 'users', 'login-page', 'notifications'];
    const hash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO admins (username, password_hash, display_name, permissions, is_super_admin)
       VALUES ($1, $2, $3, $4, true)`,
      [username, hash, 'Super Admin', JSON.stringify(allPermissions)]
    );
    console.log(`Seeded super admin: ${username}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
