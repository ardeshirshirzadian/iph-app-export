import 'server-only';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';
import { getThemeColors } from './getThemeColors';
import { getContrastTextColor, resolveEffectiveBackground } from './getContrastTextColor';

export const BUTTON_DEFAULTS = {
  dark: {
    primary:   { bg: '#00ffb3', text: '#021f20', border: 'transparent',            fontSize: 14 },
    secondary: { bg: 'rgba(5,64,65,0.4)',   text: '#ffffff',  border: 'rgba(255,255,255,0.1)',  fontSize: 14 },
    danger:    { bg: 'rgba(239,68,68,0.08)', text: '#ef4444', border: 'rgba(239,68,68,0.3)',    fontSize: 14 },
    ghost:     { bg: 'transparent',          text: '#00ffb3', border: 'transparent',            fontSize: 14 },
    icon:      { bg: 'rgba(255,255,255,0.05)', text: '#ffffff', border: 'rgba(255,255,255,0.1)', fontSize: 14 },
  },
  light: {
    primary:   { bg: '#047857', text: '#f0faf8', border: 'transparent',            fontSize: 14 },
    secondary: { bg: 'rgba(255,255,255,0.8)', text: '#0f2420', border: 'rgba(15,36,32,0.1)',  fontSize: 14 },
    danger:    { bg: 'rgba(239,68,68,0.06)', text: '#dc2626', border: 'rgba(220,38,38,0.3)', fontSize: 14 },
    ghost:     { bg: 'transparent',          text: '#047857', border: 'transparent',          fontSize: 14 },
    icon:      { bg: 'rgba(255,255,255,0.6)', text: '#0f2420', border: 'rgba(15,36,32,0.1)', fontSize: 14 },
  },
};

const VARIANTS = ['primary', 'secondary', 'danger', 'ghost', 'icon'];

// Computed smart defaults, derived from each variant's actual rendered background
// (per-event accent for primary; the real page bg composited under translucent
// secondary/icon overlays) instead of static literals that only happened to work
// for IranPharma's specific accent luminance. danger keeps its semantic red
// literal (not luminance-derived by design) and ghost keeps accent-as-text
// (branding, not a readability fallback) -- see getButtonStyles investigation.
// Two distinct dark/light candidate pairs, matching the two token families the
// original static defaults actually used: primary/ghost's text mimics the page's
// own near-black/near-white bg tone; secondary/icon's text uses the theme's pure
// white / body-text tone. Keyed by color lightness (dark: the near-black value,
// light: the near-white value), NOT by which theme the literal happened to live
// under -- dark-theme's secondary text is white (its translucent bg sits on a
// dark page) while light-theme's secondary text is near-black (light page), the
// opposite direction from primary's accent-driven text.
const PRIMARY_TEXT_CANDIDATES = { dark: BUTTON_DEFAULTS.dark.primary.text, light: BUTTON_DEFAULTS.light.primary.text };
const SURFACE_TEXT_CANDIDATES = { dark: BUTTON_DEFAULTS.light.secondary.text, light: BUTTON_DEFAULTS.dark.secondary.text };

function buildComputedDefaults(theme, themeColors) {
  const accent = themeColors[theme].accent;
  const pageBg = themeColors[theme].bg;
  const d = BUTTON_DEFAULTS[theme];
  return {
    primary:   { bg: accent, text: getContrastTextColor(accent, PRIMARY_TEXT_CANDIDATES) },
    secondary: { text: getContrastTextColor(resolveEffectiveBackground(d.secondary.bg, pageBg), SURFACE_TEXT_CANDIDATES) },
    icon:      { text: getContrastTextColor(resolveEffectiveBackground(d.icon.bg, pageBg), SURFACE_TEXT_CANDIDATES) },
    ghost:     { text: accent },
    danger:    { text: d.danger.text },
  };
}

// eventId: pass explicitly from inside an unstable_cache-wrapped call site --
// see lib/getActiveFont.js for why.
//
// button_colors (iph-apn, event-scoped) only stores a text-color override per
// (theme, variant) -- bg/border/fontSize are not admin-configurable. bg defaults
// to a computed value (see buildComputedDefaults) except for secondary/danger/icon,
// which keep their fixed BUTTON_DEFAULTS literal. Only .text gets replaced per
// variant; spreading a bare color string over a variant's whole style object
// would blow away its bg/border/fontSize (see route.js comment / investigation
// for the bug this avoided).
export async function getButtonStyles(eventId) {
  try {
    eventId = eventId ?? await getCurrentEventId();
    const [result, themeColors] = await Promise.all([
      query(
        'SELECT theme, variant, color_value FROM button_colors WHERE event_id = $1',
        [eventId]
      ),
      getThemeColors(eventId),
    ]);
    const textOverrides = { dark: {}, light: {} };
    for (const row of result.rows) {
      if (textOverrides[row.theme] !== undefined) {
        textOverrides[row.theme][row.variant] = row.color_value;
      }
    }

    const applyOverrides = (theme) => {
      let computed = {};
      try {
        computed = buildComputedDefaults(theme, themeColors);
      } catch (err) {
        console.error('getButtonStyles: computed-default resolution failed, falling back to static literals:', err);
      }
      return Object.fromEntries(
        VARIANTS.map((v) => {
          const fallback = BUTTON_DEFAULTS[theme][v];
          const c = computed[v] ?? {};
          return [
            v,
            {
              ...fallback,
              bg: c.bg ?? fallback.bg,
              text: textOverrides[theme][v] ?? c.text ?? fallback.text,
            },
          ];
        })
      );
    };

    return {
      dark: applyOverrides('dark'),
      light: applyOverrides('light'),
    };
  } catch {
    return BUTTON_DEFAULTS;
  }
}

export function buildButtonCssVars(styles) {
  const toVars = (theme, map) =>
    VARIANTS.flatMap((v) => {
      const s = map[v] ?? BUTTON_DEFAULTS[theme][v];
      return [
        `  --btn-${v}-bg: ${s.bg};`,
        `  --btn-${v}-text: ${s.text};`,
        `  --btn-${v}-border: ${s.border};`,
        `  --btn-${v}-size: ${s.fontSize ?? 14}px;`,
      ];
    }).join('\n');

  return `:root {\n${toVars('dark', styles.dark)}\n}\n\nhtml.light {\n${toVars('light', styles.light)}\n}`;
}
