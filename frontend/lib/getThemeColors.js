import 'server-only';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';

const DEFAULT_COLORS = {
  dark: {
    bg: '#021f20',
    accent: '#00ffb3',
    surface: 'rgba(5,64,65,0.4)',
    'surface-alt': 'color-mix(in srgb, var(--accent) 12%, transparent)',
    border: 'rgba(255,255,255,0.1)',
    text: '#ffffff',
    'text-muted': 'rgba(255,255,255,0.5)',
    'text-dim': 'rgba(255,255,255,0.25)',
  },
  light: {
    bg: '#f0faf8',
    accent: '#047857',
    surface: 'rgba(255,255,255,0.8)',
    'surface-alt': 'color-mix(in srgb, var(--accent) 12%, transparent)',
    border: 'rgba(15,36,32,0.1)',
    text: '#0f2420',
    'text-muted': 'rgba(15,36,32,0.6)',
    'text-dim': 'rgba(15,36,32,0.4)',
  },
};

// eventId: pass explicitly from inside an unstable_cache-wrapped call site --
// see lib/getActiveFont.js for why.
export async function getThemeColors(eventId) {
  try {
    eventId = eventId ?? await getCurrentEventId();
    const result = await query(
      'SELECT theme, color_key, color_value FROM theme_colors WHERE event_id = $1',
      [eventId]
    );
    if (result.rows.length === 0) return DEFAULT_COLORS;

    const colors = {
      dark: { ...DEFAULT_COLORS.dark },
      light: { ...DEFAULT_COLORS.light },
    };
    for (const row of result.rows) {
      if (colors[row.theme]) {
        colors[row.theme][row.color_key] = row.color_value;
      }
    }
    return colors;
  } catch (err) {
    console.error('getThemeColors error:', err);
    return DEFAULT_COLORS;
  }
}

export function buildColorStyle(colors) {
  const toVars = (map) =>
    Object.entries(map)
      .map(([k, v]) => `  --${k}: ${v};`)
      .join('\n');

  return `:root {\n${toVars(colors.dark)}\n}\n\nhtml.light {\n${toVars(colors.light)}\n}`;
}
