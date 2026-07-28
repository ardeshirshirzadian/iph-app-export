// Migration: create quest_levels table and seed with 3 default levels.
// Run once: node scripts/migrate-quest-levels.js
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS quest_levels (
        id         SERIAL       PRIMARY KEY,
        name_fa    VARCHAR(100) NOT NULL,
        name_en    VARCHAR(100),
        icon_type  VARCHAR(10)  NOT NULL DEFAULT 'emoji',
        icon_value VARCHAR(500) NOT NULL DEFAULT '⭐',
        icon_size  INT          NOT NULL DEFAULT 14,
        min_xp     INT          NOT NULL DEFAULT 0,
        max_xp     INT,
        color      VARCHAR(20),
        sort_order INT          NOT NULL DEFAULT 0,
        is_active  BOOLEAN      NOT NULL DEFAULT true,
        created_at TIMESTAMP    DEFAULT NOW(),
        updated_at TIMESTAMP    DEFAULT NOW()
      )
    `);
    console.log('✓ Table quest_levels created (or already existed)');

    const { rows } = await client.query('SELECT COUNT(*) FROM quest_levels');
    if (parseInt(rows[0].count, 10) === 0) {
      await client.query(`
        INSERT INTO quest_levels
          (name_fa, name_en, icon_type, icon_value, icon_size, min_xp, max_xp, color, sort_order, is_active)
        VALUES
          ('تازه‌وارد', 'Newcomer', 'emoji', '🌱', 14,   0, 200,  '#64748b', 0, true),
          ('کاوشگر',    'Explorer', 'emoji', '🕵️', 14, 200, 500,  '#22c55e', 1, true),
          ('کاربلد',    'Expert',   'emoji', '😎', 14, 500, NULL, '#f59e0b', 2, true)
      `);
      console.log('✓ Seeded 3 default levels');
    } else {
      console.log(`ℹ  Skipped seeding — ${rows[0].count} level(s) already exist`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => { console.error(e); process.exit(1); });
