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
