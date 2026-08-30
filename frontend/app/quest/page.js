import {
  getCachedQuestContentBlocks,
  getCachedQuestAppearanceConfig,
  getCachedQuestSettings,
  getCachedQuestPageTitle,
  parseQuestBlocks,
} from "@/lib/questPageCache";
import { getCurrentEventId } from "@/lib/currentEvent";
import QuestClient from "./QuestClient";

export default async function QuestPage() {
  const currentEventId = await getCurrentEventId();
  let content = { main: {}, missions: [], leaderboard: [], badges: [] };

  try {
    const rows = await getCachedQuestContentBlocks(currentEventId);
    content = parseQuestBlocks(rows);
  } catch (err) {
    // Gracefully fall back to QuestClient's hardcoded defaults
    console.error("quest/page.js: failed to load content blocks", err);
  }

  let appearanceConfig = {};
  try {
    appearanceConfig = await getCachedQuestAppearanceConfig(currentEventId);
  } catch {
    // Fall back to defaults in QuestClient
  }

  let questSettings = {};
  try {
    questSettings = await getCachedQuestSettings(currentEventId);
  } catch {
    // Fall back to defaults in QuestClient
  }

  // getPageTitle()'s own DEFAULTS merge (lib/getPageTitles.js) already
  // resolves 'never customized' to the default title/subtitle and
  // 'explicitly cleared' to '' -- no further fallback belongs here, that
  // would re-swallow an intentional empty value (see prior quest-title bug).
  const { title, subtitle, title_en, subtitle_en } = await getCachedQuestPageTitle(currentEventId);

  return <QuestClient content={content} title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} appearanceConfig={appearanceConfig} questSettings={questSettings} />;
}
