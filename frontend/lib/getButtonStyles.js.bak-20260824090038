import 'server-only';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';

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

// eventId: pass explicitly from inside an unstable_cache-wrapped call site --
// see lib/getActiveFont.js for why.
//
// button_colors (iph-apn, event-scoped) only stores a text-color override per
// (theme, variant) -- bg/border/fontSize are not admin-configurable and always
// come from BUTTON_DEFAULTS. Only .text gets replaced per variant; spreading a
// bare color string over a variant's whole style object would blow away its
// bg/border/fontSize (see route.js comment / investigation for the bug this avoided).
export async function getButtonStyles(eventId) {
  try {
    eventId = eventId ?? await getCurrentEventId();
    const result = await query(
      'SELECT theme, variant, color_value FROM button_colors WHERE event_id = $1',
      [eventId]
    );
    const textOverrides = { dark: {}, light: {} };
    for (const row of result.rows) {
      if (textOverrides[row.theme] !== undefined) {
        textOverrides[row.theme][row.variant] = row.color_value;
      }
    }
    const applyOverrides = (theme) =>
      Object.fromEntries(
        VARIANTS.map((v) => [
          v,
          { ...BUTTON_DEFAULTS[theme][v], text: textOverrides[theme][v] ?? BUTTON_DEFAULTS[theme][v].text },
        ])
      );
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
