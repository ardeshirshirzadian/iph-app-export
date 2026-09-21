// Pure client/server helper for the Expo screen. The 100-step numeric values
// match APN Settings → Appearance exactly; 800 preserves the current live
// title style from before this became configurable.
export const EXPO_TITLE_FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
export const DEFAULT_EXPO_TITLE_FONT_WEIGHT = 800;

export function getExpoTitleFontWeight(value) {
  const weight = Number(value);
  return Number.isInteger(weight) && EXPO_TITLE_FONT_WEIGHTS.includes(weight)
    ? weight
    : DEFAULT_EXPO_TITLE_FONT_WEIGHT;
}
