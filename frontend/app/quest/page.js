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

  // These 4 reads are independent of each other (no data dependency between
  // them), so fetch concurrently instead of paying their round-trips one
  // after another. Each of the first 3 keeps its own original fallback via
  // .catch() so a failure in one doesn't take down the others; the title
  // fetch deliberately has no fallback here (unchanged from before) -- see
  // the comment above its call for why.
  const [content, appearanceConfig, questSettings, pageTitle] = await Promise.all([
    getCachedQuestContentBlocks(currentEventId)
      .then(parseQuestBlocks)
      .catch((err) => {
        // Gracefully fall back to QuestClient's hardcoded defaults
        console.error("quest/page.js: failed to load content blocks", err);
        return { main: {}, missions: [], leaderboard: [], badges: [] };
      }),
    getCachedQuestAppearanceConfig(currentEventId).catch(() => ({})),
    getCachedQuestSettings(currentEventId).catch(() => ({})),
    // getPageTitle()'s own DEFAULTS merge (lib/getPageTitles.js) already
    // resolves 'never customized' to the default title/subtitle and
    // 'explicitly cleared' to '' -- no further fallback belongs here, that
    // would re-swallow an intentional empty value (see prior quest-title bug).
    getCachedQuestPageTitle(currentEventId),
  ]);
  const { title, subtitle, title_en, subtitle_en } = pageTitle;

  return <QuestClient content={content} title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} appearanceConfig={appearanceConfig} questSettings={questSettings} />;
}
