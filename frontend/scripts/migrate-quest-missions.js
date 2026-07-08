#!/usr/bin/env node
// One-time migration: create quest_content and quest_user_progress tables.
// Run: node scripts/migrate-quest-missions.js

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
    title_fa: 'بازدید از ۳ غرفه',
    title_en: 'Visit 3 Booths',
    description_fa: 'از ۳ غرفه مختلف نمایشگاه بازدید کن',
    description_en: 'Visit 3 different exhibition booths',
    icon_type: 'emoji',
    icon_value: '🏛️',
    icon_size: 36,
    xp_reward: 60,
    mission_type: 'booth_scan',
    total: 3,
    target_company_id: null,
    sort_order: 10,
  },
  {
    title_fa: 'اولین مکالمه',
    title_en: 'First Chat',
    description_fa: 'با دستیار هوش مصنوعی چت کن',
    description_en: 'Chat with the AI assistant',
    icon_type: 'emoji',
    icon_value: '💬',
    icon_size: 36,
    xp_reward: 30,
    mission_type: 'chat',
    total: 1,
    target_company_id: null,
    sort_order: 20,
  },
  {
    title_fa: 'غرفه برتر',
    title_en: 'Featured Booth',
    description_fa: 'از غرفه ویژه نمایشگاه بازدید کن',
    description_en: 'Visit the featured exhibition booth',
    icon_type: 'emoji',
    icon_value: '⭐',
    icon_size: 36,
    xp_reward: 50,
    mission_type: 'special_booth',
    total: 1,
    target_company_id: null,
    sort_order: 30,
  },
  {
    title_fa: 'شرکت در مراسم افتتاحیه',
    title_en: 'Opening Ceremony',
    description_fa: 'در مراسم افتتاحیه شرکت کن',
    description_en: 'Attend the opening ceremony',
    icon_type: 'emoji',
    icon_value: '🎤',
    icon_size: 36,
    xp_reward: 300,
    mission_type: 'attendance',
    total: 1,
    target_company_id: null,
    sort_order: 40,
  },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_content (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL DEFAULT 18,
        title_fa VARCHAR(200) NOT NULL,
        title_en VARCHAR(200),
        description_fa TEXT,
        description_en TEXT,
        icon_type VARCHAR(20) NOT NULL DEFAULT 'emoji',
        icon_value VARCHAR(500) NOT NULL DEFAULT '🏆',
        icon_size INTEGER DEFAULT 36,
        xp_reward INTEGER NOT NULL DEFAULT 10,
        mission_type VARCHAR(50) NOT NULL DEFAULT 'booth_scan',
        total INTEGER NOT NULL DEFAULT 1,
        target_company_id INTEGER,
        is_active BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('quest_content table created (or already exists).');

    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_user_progress (
        id SERIAL PRIMARY KEY,
        mission_id INTEGER NOT NULL REFERENCES quest_content(id) ON DELETE CASCADE,
        user_uuid VARCHAR(100) NOT NULL,
        completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(mission_id, user_uuid)
      )
    `);
    console.log('quest_user_progress table created (or already exists).');

    const { rows: existing } = await client.query('SELECT COUNT(*) FROM quest_content');
    if (parseInt(existing[0].count, 10) > 0) {
      console.log('quest_content already has data — skipping seed.');
      return;
    }

    for (const m of SEED) {
      await client.query(
        `INSERT INTO quest_content
           (title_fa, title_en, description_fa, description_en,
            icon_type, icon_value, icon_size,
            xp_reward, mission_type, total, target_company_id, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          m.title_fa, m.title_en, m.description_fa, m.description_en,
          m.icon_type, m.icon_value, m.icon_size,
          m.xp_reward, m.mission_type, m.total, m.target_company_id, m.sort_order,
        ]
      );
    }
    console.log(`Seeded ${SEED.length} missions.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
