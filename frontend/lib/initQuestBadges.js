// Creates and seeds quest_badges + quest_attendance_log tables on first use.
import { query } from './db';

const CREATE_BADGES_TABLE = `
  CREATE TABLE IF NOT EXISTS quest_badges (
    id SERIAL PRIMARY KEY,
    name_fa VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    description_fa TEXT,
    description_en TEXT,
    icon_type VARCHAR(10) NOT NULL DEFAULT 'emoji',
    icon_value VARCHAR(500) NOT NULL DEFAULT '🏆',
    icon_size INT NOT NULL DEFAULT 36,
    badge_type VARCHAR(30) NOT NULL DEFAULT 'booth_scan_count',
    threshold INT NOT NULL DEFAULT 1,
    target_company_id INT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0,
    target_hall_name VARCHAR(50),
    hall_match_mode VARCHAR(10) NOT NULL DEFAULT 'any',
    hall_scan_count INT,
    featured_booth_pool         JSONB,
    featured_booth_bonus_xp     INT NOT NULL DEFAULT 500,
    featured_booth_rotation_hours INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )
`;

const CREATE_ATTENDANCE_TABLE = `
  CREATE TABLE IF NOT EXISTS quest_attendance_log (
    id SERIAL PRIMARY KEY,
    user_uuid VARCHAR(100) NOT NULL,
    event_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    event_id INTEGER NOT NULL DEFAULT 1 REFERENCES events(id)
  )
`;

// Migrates a pre-existing table (event_id added out-of-band, without this
// bootstrap or its uniqueness constraint being updated to match) to be
// event-scoped. Without this, the same account attending both events on the
// same calendar day would have its second event's row silently dropped by
// the old (user_uuid, event_date) constraint (ON CONFLICT DO NOTHING),
// corrupting consecutive_days badge tracking for anyone active in both.
// CREATE UNIQUE INDEX IF NOT EXISTS makes the new constraint idempotent
// (unlike ADD CONSTRAINT, which has no IF NOT EXISTS form) -- ON CONFLICT
// can target a unique index directly, no named constraint required.
async function migrateAttendanceLogEventScoping() {
  await query(`ALTER TABLE quest_attendance_log ADD COLUMN IF NOT EXISTS event_id INTEGER NOT NULL DEFAULT 1`);
  await query(`ALTER TABLE quest_attendance_log DROP CONSTRAINT IF EXISTS quest_attendance_log_user_uuid_event_date_key`);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS quest_attendance_log_user_date_event_uidx
      ON quest_attendance_log (user_uuid, event_date, event_id)
  `);
}

const SEED = [
  {
    name_fa: 'کاوشگر غرفه‌ها',    name_en: 'Booth Explorer',
    description_fa: 'از ۳ غرفه بازدید کردی',
    description_en: 'You visited 3 booths',
    icon_type: 'emoji', icon_value: '🏛️', icon_size: 36,
    badge_type: 'booth_scan_count', threshold: 3,
    sort_order: 10,
  },
  {
    name_fa: 'گفتگوگر',            name_en: 'Conversationalist',
    description_fa: 'اولین مکالمه با دستیار هوش مصنوعی',
    description_en: 'First chat with the AI assistant',
    icon_type: 'emoji', icon_value: '💬', icon_size: 36,
    badge_type: 'chat', threshold: 1,
    sort_order: 20,
  },
  {
    name_fa: 'کاشف ویژه',          name_en: 'Special Finder',
    description_fa: 'غرفه ویژه نمایشگاه را پیدا کن',
    description_en: 'Find the featured exhibition booth',
    icon_type: 'emoji', icon_value: '⭐', icon_size: 36,
    badge_type: 'special_booth', threshold: 1, target_company_id: null,
    sort_order: 30,
  },
  {
    name_fa: 'نشانه‌گیر دقیق',     name_en: 'Sharp Scanner',
    description_fa: '۵ غرفه را اسکن کن',
    description_en: 'Scan 5 booths',
    icon_type: 'emoji', icon_value: '🎯', icon_size: 36,
    badge_type: 'booth_scan_count', threshold: 5,
    sort_order: 40,
  },
  {
    name_fa: 'ماراتون‌کار',        name_en: 'Marathon Scanner',
    description_fa: '۱۰ غرفه را در یک روز اسکن کن',
    description_en: 'Scan 10 booths in a single day',
    icon_type: 'emoji', icon_value: '🔥', icon_size: 36,
    badge_type: 'booth_scan_single_day', threshold: 10,
    sort_order: 50,
  },
  {
    name_fa: 'پایه ثابت نمایشگاه', name_en: 'Exhibition Regular',
    description_fa: 'حضور ۳ روز متوالی در نمایشگاه',
    description_en: 'Attend 3 consecutive days',
    icon_type: 'emoji', icon_value: '📅', icon_size: 36,
    badge_type: 'consecutive_days', threshold: 3,
    sort_order: 60,
  },
];

export async function ensureQuestBadgesTable(eventId) {
  if (!globalThis._questBadgesInitializedEvents) {
    globalThis._questBadgesInitializedEvents = new Set();
  }

  await query(CREATE_BADGES_TABLE);
  await query(`ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS icon_color_dark TEXT`);
  await query(`ALTER TABLE quest_badges ADD COLUMN IF NOT EXISTS icon_color_light TEXT`);

  if (globalThis._questBadgesInitializedEvents.has(eventId)) return;

  const { rows } = await query(
    'SELECT COUNT(*)::int AS cnt FROM quest_badges WHERE event_id = $1',
    [eventId]
  );
  if (rows[0].cnt === 0) {
    for (const b of SEED) {
      await query(
        `INSERT INTO quest_badges
           (name_fa, name_en, description_fa, description_en,
            icon_type, icon_value, icon_size,
            badge_type, threshold, target_company_id, sort_order, event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          b.name_fa, b.name_en, b.description_fa, b.description_en,
          b.icon_type, b.icon_value, b.icon_size,
          b.badge_type, b.threshold, b.target_company_id ?? null, b.sort_order,
          eventId,
        ]
      );
    }
  }

  globalThis._questBadgesInitializedEvents.add(eventId);
}

export async function ensureAttendanceLogTable() {
  if (globalThis._attendanceLogInitialized) return;
  await query(CREATE_ATTENDANCE_TABLE);
  await migrateAttendanceLogEventScoping();
  globalThis._attendanceLogInitialized = true;
}

export async function ensureBadgeProgressTable() {
  if (globalThis._badgeProgressInitialized) return;
  await query(`
    CREATE TABLE IF NOT EXISTS quest_badge_progress (
      id SERIAL PRIMARY KEY,
      badge_id INT NOT NULL,
      user_uuid VARCHAR(100) NOT NULL,
      earned BOOLEAN DEFAULT true,
      earned_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(badge_id, user_uuid)
    )
  `);
  globalThis._badgeProgressInitialized = true;
}
