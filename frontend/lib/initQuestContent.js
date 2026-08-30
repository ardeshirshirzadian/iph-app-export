// TEMPORARY: Static content layer for quest feature.
// This module creates and seeds quest_content_blocks table.
// When real quest logic (scoring, live data) is built, this seed data
// can be migrated or replaced — this file should be removed then.
import { query } from './db';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS quest_content_blocks (
    id SERIAL PRIMARY KEY,
    section VARCHAR(30) NOT NULL,
    block_type VARCHAR(20) NOT NULL,
    block_key VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    sort_order INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
  )
`;

const SEED_ROWS = [
  // ── Main section: text labels ──────────────────────────────────────────────
  ['main', 'text', 'title',               'Booth Quest',                    10],
  ['main', 'text', 'subtitle',            'نمایشگاه ایران فارما',           20],
  ['main', 'text', 'scan_button_label',   'اسکن QR غرفه',                  30],
  ['main', 'text', 'user_card_label',     'کاربر',                          40],
  ['main', 'text', 'xp_label',            'امتیاز فعلی',                    50],
  ['main', 'text', 'next_level_prefix',   'تا سطح بعدی:',                   60],
  ['main', 'text', 'xp_remaining_suffix', 'XP مانده',                       70],
  ['main', 'text', 'xp_unit',            'XP',                              75],
  ['main', 'text', 'stat_xp_label',       'امتیاز امروز',                   80],
  ['main', 'text', 'stat_scanned_label',  'غرفه اسکن‌شده',                  90],
  ['main', 'text', 'stat_rank_label',     'رتبه شما',                      100],
  ['main', 'text', 'view_list_label',     'مشاهده لیست',                   110],
  ['main', 'text', 'missions_today_label','ماموریت‌های فعال',               120],
  ['main', 'text', 'missions_completed_label','ماموریت‌های انجام‌شده',      121],
  ['main', 'text', 'booths_sheet_title',  'غرفه‌های نمایشگاه',             130],
  ['main', 'text', 'tab_missions',        'مأموریت‌ها',                                    140],
  ['main', 'text', 'icon_tab_missions',   JSON.stringify({ icon: '🎯', icon_size: 18 }), 141],
  ['main', 'text', 'tab_leaderboard',     'لیدربورد',                                    150],
  ['main', 'text', 'icon_tab_leaderboard',JSON.stringify({ icon: '🏅', icon_size: 18 }), 151],
  ['main', 'text', 'tab_badges',          'بج‌ها',                                       160],
  ['main', 'text', 'icon_tab_badges',     JSON.stringify({ icon: '🎖️', icon_size: 18 }), 161],
  ['main', 'text', 'level_0_name',        'تازه‌وارد',                                   170],
  ['main', 'text', 'icon_level_0',        JSON.stringify({ icon: '🌱', icon_size: 14 }), 171],
  ['main', 'text', 'level_1_name',        'کاوشگر',                                      180],
  ['main', 'text', 'icon_level_1',        JSON.stringify({ icon: '🕵️', icon_size: 14 }), 181],
  ['main', 'text', 'level_2_name',        'کاربلد',                                      190],
  ['main', 'text', 'icon_level_2',        JSON.stringify({ icon: '😎', icon_size: 14 }), 191],

  // ── Missions (JSON content per mission) ───────────────────────────────────
  // progress/earned below are the starting (not-yet-completed) state for a
  // brand-new event -- these blocks are shown to EVERY visitor as-is
  // whenever an event has no real quest_content rows yet (see
  // lib/questPageCache.js), so a nonzero progress/true earned here isn't a
  // per-user preview, it's a fake "already done" shown to literally everyone
  // (confirmed: this is what caused Iran Cosmetica's chat mission to render
  // as checked for every user before any of them had actually chatted).
  ['missions', 'text', 'mission_1',
    JSON.stringify({ icon: '🏛️', title: 'بازدید از ۳ غرفه',
      description: 'از ۳ غرفه مختلف نمایشگاه بازدید کن',
      xpReward: 60, progress: 0, total: 3 }), 10],
  ['missions', 'text', 'mission_2',
    JSON.stringify({ icon: '💬', title: 'اولین مکالمه',
      description: 'با دستیار هوش مصنوعی چت کن',
      xpReward: 30, progress: 0, total: 1 }), 20],
  ['missions', 'text', 'mission_3',
    JSON.stringify({ icon: '⭐', title: 'غرفه برتر',
      description: 'از غرفه ویژه نمایشگاه بازدید کن',
      xpReward: 50, progress: 0, total: 1 }), 30],
  ['missions', 'text', 'mission_4',
    JSON.stringify({ icon: '🎤', title: 'شرکت در مراسم افتتاحیه',
      description: 'در مراسم افتتاحیه شرکت کن',
      xpReward: 300, progress: 0, total: 1 }), 40],

  // ── Badges (JSON content per badge) ──────────────────────────────────────
  // Same reasoning as the missions block above: earned:true here shows as
  // already-earned to every visitor of a brand-new event, not just a preview.
  ['badges', 'text', 'badge_1',
    JSON.stringify({ icon: '🏛️', name: 'کاوشگر غرفه‌ها',
      description: 'از ۳ غرفه بازدید کردی', earned: false }), 10],
  ['badges', 'text', 'badge_2',
    JSON.stringify({ icon: '💬', name: 'گفتگوگر',
      description: 'اولین مکالمه با دستیار هوش مصنوعی', earned: false }), 20],
  ['badges', 'text', 'badge_3',
    JSON.stringify({ icon: '⭐', name: 'کاشف ویژه',
      description: 'غرفه ویژه نمایشگاه را پیدا کن', earned: false }), 30],
  ['badges', 'text', 'badge_4',
    JSON.stringify({ icon: '🎯', name: 'نشانه‌گیر دقیق',
      description: '۵ غرفه را اسکن کن', earned: false }), 40],
  ['badges', 'text', 'badge_5',
    JSON.stringify({ icon: '🔥', name: 'ماراتون‌کار',
      description: '۱۰ غرفه را در یک روز اسکن کن', earned: false }), 50],
  ['badges', 'text', 'badge_6',
    JSON.stringify({ icon: '📅', name: 'پایه ثابت نمایشگاه',
      description: 'حضور ۳ روز متوالی در نمایشگاه', earned: false }), 60],
];

export async function ensureQuestContentTable(eventId) {
  if (!globalThis._questContentInitializedEvents) {
    globalThis._questContentInitializedEvents = new Set();
  }

  await query(CREATE_TABLE);

  if (globalThis._questContentInitializedEvents.has(eventId)) return;

  const { rows } = await query(
    'SELECT COUNT(*)::int AS cnt FROM quest_content_blocks WHERE event_id = $1',
    [eventId]
  );
  if (rows[0].cnt === 0) {
    for (const [section, block_type, block_key, content, sort_order] of SEED_ROWS) {
      await query(
        `INSERT INTO quest_content_blocks (section, block_type, block_key, content, sort_order, event_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [section, block_type, block_key, content, sort_order, eventId]
      );
    }
  } else {
    // Ensure new fields added after initial seed exist in existing installations
    const { rows: existing } = await query(
      "SELECT id FROM quest_content_blocks WHERE event_id = $1 AND section = 'main' AND block_key = 'xp_unit'",
      [eventId]
    );
    if (existing.length === 0) {
      await query(
        `INSERT INTO quest_content_blocks (section, block_type, block_key, content, sort_order, event_id)
         VALUES ('main', 'text', 'xp_unit', 'XP', 75, $1)`,
        [eventId]
      );
    }

    const { rows: existingCompletedLabel } = await query(
      "SELECT id FROM quest_content_blocks WHERE event_id = $1 AND section = 'main' AND block_key = 'missions_completed_label'",
      [eventId]
    );
    if (existingCompletedLabel.length === 0) {
      await query(
        `INSERT INTO quest_content_blocks (section, block_type, block_key, content, sort_order, event_id)
         VALUES ('main', 'text', 'missions_completed_label', 'ماموریت‌های انجام‌شده', 121, $1)`,
        [eventId]
      );
    }
  }

  globalThis._questContentInitializedEvents.add(eventId);
}
