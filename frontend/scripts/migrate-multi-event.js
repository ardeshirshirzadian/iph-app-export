/**
 * Migration: introduce the local `events` table and local `event_id` column
 * across the schema (multi-event architecture, Phase 1), and the
 * `admin_event_access` permission table.
 *
 * IMPORTANT — two different "event id" concepts exist after this migration:
 *   - event_id            = NEW local concept (IranPharma = 1). Added to ~28 tables here.
 *   - rasayesh_event_id   = EXISTING concept (Rasayesh platform's per-year event id,
 *                           e.g. 18, 26). Renamed from the old `event_id` column on
 *                           companies/panels/quest_content to avoid collision with the
 *                           new local event_id above. Do not confuse the two.
 *
 * Run once: node scripts/migrate-multi-event.js
 * Dry run (BEGIN..ROLLBACK, no changes committed): node scripts/migrate-multi-event.js --dry-run
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DRY_RUN = process.argv.includes('--dry-run');

// Tables that get a plain new local event_id column (DEFAULT 1, backed by FK to events).
// Includes companies/panels/quest_content, whose OLD event_id column is renamed to
// rasayesh_event_id first (see renameRasayeshEventId below) before this loop runs.
const EVENT_ID_TABLES = [
  'companies', 'panels', 'quest_content',
  'map_doors', 'map_elements', 'map_hall_floors', 'map_walls', 'map_zones',
  'banners', 'bottom_nav_items', 'header_items', 'notifications', 'services',
  'quest_badges', 'quest_levels', 'app_pages', 'quest_content_blocks',
  'push_subscriptions', 'quest_attendance_log', 'quest_badge_progress',
  'quest_quiz_attempts', 'quest_scans', 'quest_social_share_submissions',
  'quest_survey_responses', 'quest_user_names', 'quest_xp_grants',
];

// Single source of truth for admin section keys, snapshotted at migration time.
// Must match lib/adminSections.js ADMIN_SECTIONS keys. Kept as a local const (not
// imported) because this script runs standalone via `node`, not through Next.js.
const VALID_SECTION_KEYS = [
  'chatbot', 'app-settings', 'design', 'services', 'quest', 'users', 'login-page',
  'notifications', 'companies', 'panels', 'map', 'badge', 'book', 'cart', 'registration',
];

async function renameRasayeshEventId(client) {
  for (const table of ['companies', 'panels', 'quest_content']) {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'event_id'`,
      [table]
    );
    if (rows.length > 0) {
      await client.query(`ALTER TABLE ${table} RENAME COLUMN event_id TO rasayesh_event_id`);
      console.log(`✓ ${table}.event_id renamed to rasayesh_event_id`);
    } else {
      console.log(`- ${table}.event_id already renamed (skipped)`);
    }
  }
}

async function addEventIdColumn(client, table) {
  await client.query(
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS event_id INTEGER NOT NULL DEFAULT 1 REFERENCES events(id)`
  );
  console.log(`✓ ${table}.event_id`);
}

async function dropConstraintIfExists(client, table, constraintName) {
  await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraintName}`);
}

async function addConstraintIfMissing(client, table, constraintName, ddl) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1`,
    [constraintName]
  );
  if (rows.length === 0) {
    await client.query(ddl);
    console.log(`✓ ${table}: ${constraintName} added`);
  } else {
    console.log(`- ${table}: ${constraintName} already exists (skipped)`);
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1a. events table ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        domain VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
      )
    `);
    await client.query(`
      INSERT INTO events (id, name, slug, domain, status)
      VALUES (1, 'IranPharma', 'iranpharma', 'app.iphexpo.com', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await client.query(`SELECT setval('events_id_seq', (SELECT MAX(id) FROM events), true)`);
    console.log('✓ events table + IranPharma seed row (id=1)');

    // ── 1b. rename existing Rasayesh event_id → rasayesh_event_id ──────────
    await renameRasayeshEventId(client);

    // ── 1c. add new local event_id to the 25 tables ────────────────────────
    for (const table of EVENT_ID_TABLES) {
      await addEventIdColumn(client, table);
    }

    // ── 1d. composite-key tables ────────────────────────────────────────────
    // app_settings: PK key -> PK (event_id, key)
    await client.query(
      `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS event_id INTEGER NOT NULL DEFAULT 1 REFERENCES events(id)`
    );
    await dropConstraintIfExists(client, 'app_settings', 'app_settings_pkey');
    await addConstraintIfMissing(
      client, 'app_settings', 'app_settings_pkey',
      `ALTER TABLE app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (event_id, key)`
    );
    console.log('✓ app_settings.event_id + composite PK (event_id, key)');

    // theme_colors: PK (theme, color_key) -> PK (event_id, theme, color_key)
    await client.query(
      `ALTER TABLE theme_colors ADD COLUMN IF NOT EXISTS event_id INTEGER NOT NULL DEFAULT 1 REFERENCES events(id)`
    );
    await dropConstraintIfExists(client, 'theme_colors', 'theme_colors_pkey');
    await addConstraintIfMissing(
      client, 'theme_colors', 'theme_colors_pkey',
      `ALTER TABLE theme_colors ADD CONSTRAINT theme_colors_pkey PRIMARY KEY (event_id, theme, color_key)`
    );
    console.log('✓ theme_colors.event_id + composite PK (event_id, theme, color_key)');

    // login_page_settings: PK key -> PK (event_id, key)
    await client.query(
      `ALTER TABLE login_page_settings ADD COLUMN IF NOT EXISTS event_id INTEGER NOT NULL DEFAULT 1 REFERENCES events(id)`
    );
    await dropConstraintIfExists(client, 'login_page_settings', 'login_page_settings_pkey');
    await addConstraintIfMissing(
      client, 'login_page_settings', 'login_page_settings_pkey',
      `ALTER TABLE login_page_settings ADD CONSTRAINT login_page_settings_pkey PRIMARY KEY (event_id, key)`
    );
    console.log('✓ login_page_settings.event_id + composite PK (event_id, key)');

    // app_pages: unique page_key -> unique (event_id, page_key) — event_id column
    // already added by the EVENT_ID_TABLES loop above.
    await dropConstraintIfExists(client, 'app_pages', 'app_pages_page_key_key');
    await addConstraintIfMissing(
      client, 'app_pages', 'app_pages_event_page_key_key',
      `ALTER TABLE app_pages ADD CONSTRAINT app_pages_event_page_key_key UNIQUE (event_id, page_key)`
    );
    console.log('✓ app_pages: unique (event_id, page_key)');

    // app_users: unique uuid -> unique (event_id, uuid)
    await client.query(
      `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS event_id INTEGER NOT NULL DEFAULT 1 REFERENCES events(id)`
    );
    await dropConstraintIfExists(client, 'app_users', 'app_users_uuid_key');
    await addConstraintIfMissing(
      client, 'app_users', 'app_users_event_uuid_key',
      `ALTER TABLE app_users ADD CONSTRAINT app_users_event_uuid_key UNIQUE (event_id, uuid)`
    );
    console.log('✓ app_users.event_id + unique (event_id, uuid)');

    // ── 2. admin_event_access ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_event_access (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        section_key VARCHAR(50) NOT NULL,
        UNIQUE (admin_id, event_id, section_key)
      )
    `);
    console.log('✓ admin_event_access table');

    // Backfill from admins.permissions (jsonb array) -> admin_event_access rows
    // scoped to event_id=1, dropping any key not in VALID_SECTION_KEYS (e.g. the
    // stale 'appearance' key).
    const { rows: admins } = await client.query(
      `SELECT id, permissions, is_super_admin FROM admins`
    );
    let backfilled = 0;
    for (const admin of admins) {
      if (admin.is_super_admin) continue; // super admins bypass, no rows needed
      const perms = Array.isArray(admin.permissions) ? admin.permissions : [];
      for (const key of perms) {
        if (!VALID_SECTION_KEYS.includes(key)) continue;
        const { rowCount } = await client.query(
          `INSERT INTO admin_event_access (admin_id, event_id, section_key)
           VALUES ($1, 1, $2)
           ON CONFLICT (admin_id, event_id, section_key) DO NOTHING`,
          [admin.id, key]
        );
        backfilled += rowCount;
      }
    }
    console.log(`✓ admin_event_access backfilled: ${backfilled} rows from ${admins.length} admins`);

    // ── verification ────────────────────────────────────────────────────────
    const allTables = [...EVENT_ID_TABLES, 'app_settings', 'theme_colors', 'login_page_settings', 'app_users'];
    // de-dupe (app_pages appears only once, already in EVENT_ID_TABLES)
    const uniqueTables = [...new Set(allTables)];
    for (const table of uniqueTables) {
      const { rows } = await client.query(`SELECT COUNT(*) FROM ${table} WHERE event_id != 1`);
      const count = parseInt(rows[0].count, 10);
      if (count !== 0) {
        throw new Error(`Verification failed: ${table} has ${count} rows with event_id != 1 (expected 0)`);
      }
      console.log(`✓ verify ${table}: 0 rows with event_id != 1`);
    }

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN complete — all changes rolled back, nothing was committed.');
    } else {
      await client.query('COMMIT');
      console.log('\nMigration complete and committed.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
