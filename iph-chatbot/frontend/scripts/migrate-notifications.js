#!/usr/bin/env node
// One-time migration: create notifications table and seed initial notifications.
// Run: node scripts/migrate-notifications.js

const fs = require('fs');
const envPath = require('path').join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SEED = [
  {
    icon: '👋',
    title: 'به IranPharma Super App خوش آمدید!',
    description: 'برنامه نمایشگاه را کشف کنید و از امکانات استفاده کنید',
    is_default: true,
  },
  {
    icon: '📅',
    title: 'کارگاه‌های نمایشگاه به زودی اعلام می‌شود',
    description: 'لیست کارگاه‌های آموزشی در حال تهیه است',
    is_default: true,
  },
  {
    icon: '🏆',
    title: 'Booth Quest فعال شد',
    description: 'شروع به امتیاز جمع کردن کنید و به صدر لیدربورد برسید',
    is_default: true,
  },
  {
    icon: '📢',
    title: 'اطلاعیه افتتاحیه نمایشگاه',
    description: 'مراسم افتتاحیه روز اول از ساعت ۱۰ صبح آغاز می‌شود',
    is_default: false,
  },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        icon VARCHAR(10),
        title VARCHAR(200) NOT NULL,
        description TEXT,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Table created (or already exists).');

    const { rows: existing } = await client.query('SELECT COUNT(*) FROM notifications');
    if (parseInt(existing[0].count) > 0) {
      console.log('Notifications table already has data — skipping seed.');
      return;
    }

    for (const n of SEED) {
      await client.query(
        'INSERT INTO notifications (icon, title, description, is_default) VALUES ($1, $2, $3, $4)',
        [n.icon, n.title, n.description, n.is_default]
      );
    }
    console.log(`Seeded ${SEED.length} notifications.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
