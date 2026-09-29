// TEMPORARY: Reads static content from quest_content_blocks table.
// When real quest logic (scoring, live leaderboard, XP) is built, replace
// this server fetch with live data queries and update QuestClient accordingly.
//
// Shared cached reads for the quest hub's admin-curated page copy/theming
// (not live user/quest-progress state -- that's all fetched client-side by
// QuestClient from /api/quest/*, untouched by this module -- see those
// routes' own caching, which is scoped to definitions only).
//
// This module is the SINGLE cached data-fetching path for quest content
// blocks / appearance config / page title, consumed by BOTH app/quest/page.js
// (the dedicated /quest route) and app/page.js's "/quest" home variant, so
// there is exactly one cache entry per tag regardless of which route
// triggered the read, and iph-apn's admin save handlers only need to
// revalidate one tag per data type to keep both routes in sync.
import { unstable_cache } from "next/cache";
import { query } from "@/lib/db";
import { ensureQuestContentTable } from "@/lib/initQuestContent";
import { getPageTitle } from "@/lib/getPageTitles";

export const getCachedQuestContentBlocks = unstable_cache(
  async (eventId) => {
    await ensureQuestContentTable(eventId);
    const result = await query(
      "SELECT * FROM quest_content_blocks WHERE event_id = $1 ORDER BY section, sort_order ASC, id ASC",
      [eventId]
    );
    return result.rows;
  },
  ["quest-content-blocks"],
  { tags: ["quest-content-blocks"], revalidate: 300 }
);

export const getCachedQuestAppearanceConfig = unstable_cache(
  async (eventId) => {
    const appResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'quest_appearance_config'",
      [eventId]
    );
    return appResult.rows[0]?.value ?? {};
  },
  ["quest-appearance-config"],
  { tags: ["quest-appearance-config"], revalidate: 300 }
);

// The quest_content_blocks rows driving the quest page's tab bar AND top
// stat-row chrome -- label/icon/color for the 3 tabs (missions/leaderboard/
// badges), the 3 top stat boxes (XP/scanned-booths/rank, each an icon+label
// pair per QuestClient.js's `stats` object), and the 3 leaderboard rank-medal
// icons. Confirmed against QuestClient.js's actual render code (not guessed)
// -- these are the ONLY 'main'-section blocks with their own dedicated cached
// read; everything else in quest_content_blocks (page copy, the
// icon_level_*/level_*_name blocks -- confirmed dead/unread by any current
// code path -- etc.) stays on the plain getCachedQuestContentBlocks above.
// Callers merge the result over parseQuestBlocks(...).main so only these
// keys get overridden.
//
// MUST stay in sync with QUEST_TAB_CHROME_KEYS in iph-apn's
// app/api/admin/icon-import/route.js (the one-time import's copy scope).
const QUEST_TAB_CHROME_KEYS = [
  'tab_missions', 'icon_tab_missions',
  'tab_leaderboard', 'icon_tab_leaderboard',
  'tab_badges', 'icon_tab_badges',
  'icon_stat_xp', 'stat_xp_label',
  'icon_stat_scanned', 'stat_scanned_label',
  'icon_stat_rank', 'stat_rank_label',
  'icon_rank_1', 'icon_rank_2', 'icon_rank_3',
  'xp_label', 'xp_unit', 'xp_remaining_suffix', 'next_level_prefix',
];

export const getCachedQuestTabChrome = unstable_cache(
  async (eventId) => {
    await ensureQuestContentTable(eventId);
    const result = await query(
      `SELECT block_key, content, content_en FROM quest_content_blocks
       WHERE event_id = $1 AND section = 'main' AND block_key = ANY($2::text[])`,
      [eventId, QUEST_TAB_CHROME_KEYS]
    );
    const overrides = {};
    const overridesEn = {};
    for (const row of result.rows) {
      if (row.block_key.startsWith("icon_")) {
        try {
          const p = JSON.parse(row.content);
          if (typeof p === "object" && p !== null) { overrides[row.block_key] = p; continue; }
        } catch {}
      }
      overrides[row.block_key] = row.content;
      if (row.content_en) overridesEn[row.block_key] = row.content_en;
    }
    return { overrides, overridesEn };
  },
  ["quest-tab-chrome"],
  { tags: ["quest-tab-chrome"], revalidate: 300 }
);

export const getCachedQuestSettings = unstable_cache(
  async (eventId) => {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'quest_settings'",
      [eventId]
    );
    return result.rows[0]?.value ?? {};
  },
  ["quest-settings"],
  { tags: ["quest-settings"], revalidate: 300 }
);

export const getCachedQuestPageTitle = unstable_cache(
  (eventId) => getPageTitle('quest', eventId),
  ["quest-page-title"],
  { tags: ["quest-page-title"], revalidate: 300 }
);

export function parseQuestBlocks(rows) {
  const main = {};
  const main_en = {};
  const missions = [];
  const leaderboard = [];
  const badges = [];

  for (const row of rows) {
    if (row.section === "main") {
      if (row.block_key.startsWith("icon_")) {
        try {
          const p = JSON.parse(row.content);
          if (typeof p === "object" && p !== null) { main[row.block_key] = p; continue; }
        } catch {}
      }
      main[row.block_key] = row.content;
      if (row.content_en) main_en[row.block_key] = row.content_en;
    } else {
      let parsed;
      try { parsed = JSON.parse(row.content); } catch { continue; }
      const entry = { id: row.id, block_key: row.block_key, sort_order: row.sort_order, ...parsed };
      if (row.section === "missions")    missions.push(entry);
      if (row.section === "leaderboard") leaderboard.push(entry);
      if (row.section === "badges")      badges.push(entry);
    }
  }

  return { main, main_en, missions, leaderboard, badges };
}
