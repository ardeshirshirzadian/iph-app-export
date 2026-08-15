import {
  getCachedQuestContentBlocks,
  getCachedQuestAppearanceConfig,
  getCachedQuestPageTitle,
  parseQuestBlocks,
} from "@/lib/questPageCache";
import QuestClient from "./QuestClient";

export default async function QuestPage() {
  let content = { main: {}, missions: [], leaderboard: [], badges: [] };

  try {
    const rows = await getCachedQuestContentBlocks();
    content = parseQuestBlocks(rows);
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
