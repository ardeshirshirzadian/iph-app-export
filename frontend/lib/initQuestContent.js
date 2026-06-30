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
  ['main', 'text', 'stat_xp_label',       'امتیاز امروز',                   80],
  ['main', 'text', 'stat_scanned_label',  'غرفه اسکن‌شده',                  90],
  ['main', 'text', 'stat_rank_label',     'رتبه شما',                      100],
  ['main', 'text', 'view_list_label',     'مشاهده لیست',                   110],
  ['main', 'text', 'missions_today_label','مأموریت‌های امروز',              120],
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
  ['missions', 'text', 'mission_1',
    JSON.stringify({ icon: '🏛️', title: 'بازدید از ۳ غرفه',
      description: 'از ۳ غرفه مختلف نمایشگاه بازدید کن',
      xpReward: 60, progress: 1, total: 3 }), 10],
  ['missions', 'text', 'mission_2',
    JSON.stringify({ icon: '💬', title: 'اولین مکالمه',
      description: 'با دستیار هوش مصنوعی چت کن',
      xpReward: 30, progress: 1, total: 1 }), 20],
  ['missions', 'text', 'mission_3',
    JSON.stringify({ icon: '⭐', title: 'غرفه برتر',
      description: 'از غرفه ویژه نمایشگاه بازدید کن',
      xpReward: 50, progress: 0, total: 1 }), 30],
  ['missions', 'text', 'mission_4',
    JSON.stringify({ icon: '🎤', title: 'شرکت در مراسم افتتاحیه',
      description: 'در مراسم افتتاحیه شرکت کن',
      xpReward: 300, progress: 0, total: 1 }), 40],

  // ── Leaderboard (JSON content per user) ───────────────────────────────────
  ['leaderboard', 'text', 'user_1',
    JSON.stringify({ rank: 1, name: 'اردشیر شیرزادیان', company: 'بازدیدکننده',   xp: 850, level: 'کاربلد' }), 10],
  ['leaderboard', 'text', 'user_2',
    JSON.stringify({ rank: 2, name: 'علی محمدی',         company: 'داروسازی البرز', xp: 580, level: 'کاربلد' }), 20],
  ['leaderboard', 'text', 'user_3',
    JSON.stringify({ rank: 3, name: 'سارا احمدی',        company: 'شرکت دارو پخش', xp: 430, level: 'کاوشگر' }), 30],
  ['leaderboard', 'text', 'user_4',
    JSON.stringify({ rank: 4, name: 'محمد حسینی',        company: 'داروسازی تهران شیمی', xp: 390, level: 'کاوشگر' }), 40],
  ['leaderboard', 'text', 'user_5',
    JSON.stringify({ rank: 5, name: 'فاطمه رضایی',       company: 'داروسازی اکسیر', xp: 310, level: 'کاوشگر' }), 50],
  ['leaderboard', 'text', 'user_6',
    JSON.stringify({ rank: 6, name: 'رضا کریمی',         company: 'داروسازی روز دارو', xp: 270, level: 'کاوشگر' }), 60],
  ['leaderboard', 'text', 'user_7',
    JSON.stringify({ rank: 7, name: 'مریم نجفی',         company: 'شرکت پخش رازی', xp: 210, level: 'کاوشگر' }), 70],
  ['leaderboard', 'text', 'user_8',
    JSON.stringify({ rank: 8, name: 'حسین موسوی',        company: 'داروسازی زهراوی', xp: 180, level: 'تازه‌وارد' }), 80],
  ['leaderboard', 'text', 'user_9',
    JSON.stringify({ rank: 9, name: 'زهرا صادقی',        company: 'تجهیزات پزشکی پارس', xp: 95, level: 'تازه‌وارد' }), 90],
  ['leaderboard', 'text', 'user_10',
    JSON.stringify({ rank: 10, name: 'امیر قاسمی',       company: 'شرکت فن‌آوران طب', xp: 60, level: 'تازه‌وارد' }), 100],

  // ── Badges (JSON content per badge) ──────────────────────────────────────
  ['badges', 'text', 'badge_1',
    JSON.stringify({ icon: '🏛️', name: 'کاوشگر غرفه‌ها',
      description: 'از ۳ غرفه بازدید کردی', earned: true }), 10],
  ['badges', 'text', 'badge_2',
    JSON.stringify({ icon: '💬', name: 'گفتگوگر',
      description: 'اولین مکالمه با دستیار هوش مصنوعی', earned: true }), 20],
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

export async function ensureQuestContentTable() {
  if (globalThis._questContentInitialized) return;

  await query(CREATE_TABLE);

  const { rows } = await query('SELECT COUNT(*)::int AS cnt FROM quest_content_blocks');
  if (rows[0].cnt === 0) {
    for (const [section, block_type, block_key, content, sort_order] of SEED_ROWS) {
      await query(
        `INSERT INTO quest_content_blocks (section, block_type, block_key, content, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [section, block_type, block_key, content, sort_order]
      );
    }
  }

  globalThis._questContentInitialized = true;
}
