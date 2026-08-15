// TEMPORARY: Reads static content from quest_content_blocks table.
// When real quest logic (scoring, live leaderboard, XP) is built, replace
// this server fetch with live data queries and update QuestClient accordingly.
import { unstable_cache } from "next/cache";
import { query } from "@/lib/db";
import { ensureQuestContentTable } from "@/lib/initQuestContent";
import { getPageTitle } from "@/lib/getPageTitles";
import QuestClient from "./QuestClient";

// Everything this page itself reads is admin-curated page copy/theming, not
// live user/quest-progress state (that's all fetched client-side by
// QuestClient from /api/quest/*, untouched by this change — see those
// routes' own caching, which is scoped to definitions only).
const getCachedQuestContentBlocks = unstable_cache(
  async () => {
    await ensureQuestContentTable();
    const result = await query(
      "SELECT * FROM quest_content_blocks ORDER BY section, sort_order ASC, id ASC"
    );
    return result.rows;
  },
  ["quest-content-blocks"],
  { tags: ["quest-content-blocks"], revalidate: 300 }
);

const getCachedQuestAppearanceConfig = unstable_cache(
  async () => {
    const appResult = await query(
      "SELECT value FROM app_settings WHERE key = 'quest_appearance_config'"
    );
    return appResult.rows[0]?.value ?? {};
  },
  ["quest-appearance-config"],
  { tags: ["quest-appearance-config"], revalidate: 300 }
);

const getCachedQuestPageTitle = unstable_cache(
  () => getPageTitle('quest'),
  ["quest-page-title"],
  { tags: ["quest-page-title"], revalidate: 300 }
);

function parseBlocks(rows) {
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

export default async function QuestPage() {
  let content = { main: {}, missions: [], leaderboard: [], badges: [] };

  try {
    const rows = await getCachedQuestContentBlocks();
    content = parseBlocks(rows);
  } catch (err) {
    // Gracefully fall back to QuestClient's hardcoded defaults
    console.error("quest/page.js: failed to load content blocks", err);
  }

  let appearanceConfig = {};
  try {
    appearanceConfig = await getCachedQuestAppearanceConfig();
  } catch {
    // Fall back to defaults in QuestClient
  }

  const { title, subtitle, title_en, subtitle_en } = await getCachedQuestPageTitle();

  return <QuestClient content={content} title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} appearanceConfig={appearanceConfig} />;
}
