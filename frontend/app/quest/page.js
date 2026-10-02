import {
  getCachedQuestContentBlocks,
  getCachedQuestAppearanceConfig,
  getCachedQuestTabChrome,
  getCachedQuestSettings,
  getCachedQuestPageTitle,
  getCachedQuestEndState,
  parseQuestBlocks,
} from "@/lib/questPageCache";
import { getCurrentEventId } from "@/lib/currentEvent";
import QuestClient from "./QuestClient";

export default async function QuestPage() {
  const currentEventId = await getCurrentEventId();

  // These 6 reads are independent of each other (no data dependency between
  // them), so fetch concurrently instead of paying their round-trips one
  // after another. Each of the first 4 (and the new end-state read) keeps
  // its own original fallback via .catch() so a failure in one doesn't take
  // down the others; the title fetch deliberately has no fallback here
  // (unchanged from before) -- see the comment above its call for why.
  const [content, appearanceConfig, tabChrome, questSettings, pageTitle, questEndState] = await Promise.all([
    getCachedQuestContentBlocks(currentEventId)
      .then(parseQuestBlocks)
      .catch((err) => {
        // Gracefully fall back to QuestClient's hardcoded defaults
        console.error("quest/page.js: failed to load content blocks", err);
        return { main: {}, missions: [], leaderboard: [], badges: [] };
      }),
    getCachedQuestAppearanceConfig(currentEventId).catch(() => ({})),
    getCachedQuestTabChrome(currentEventId).catch(() => ({ overrides: {}, overridesEn: {} })),
    getCachedQuestSettings(currentEventId).catch(() => ({})),
    // getPageTitle()'s own DEFAULTS merge (lib/getPageTitles.js) already
    // resolves 'never customized' to the default title/subtitle and
    // 'explicitly cleared' to '' -- no further fallback belongs here, that
    // would re-swallow an intentional empty value (see prior quest-title bug).
    getCachedQuestPageTitle(currentEventId),
    getCachedQuestEndState(currentEventId).catch(() => ({ ended: false, endedAt: null })),
  ]);
  const { title, subtitle, title_en, subtitle_en } = pageTitle;
  // Merge tab-chrome overrides over the per-event content blocks -- only the
  // 6 tab keys are ever present in tabChrome.overrides, so nothing else in
  // content.main/main_en is touched.
  const mergedContent = {
    ...content,
    main: { ...content.main, ...tabChrome.overrides },
    main_en: { ...content.main_en, ...tabChrome.overridesEn },
  };

  const mergedQuestSettings = { ...questSettings, ended: questEndState.ended, endedAt: questEndState.endedAt };

  return <QuestClient content={mergedContent} title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} appearanceConfig={appearanceConfig} questSettings={mergedQuestSettings} />;
}
