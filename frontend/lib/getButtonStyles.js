import 'server-only';
import { query } from './db';

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

export async function getButtonStyles() {
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'button_styles_config'"
    );
    const saved = result.rows[0]?.value ?? {};
    return {
      dark:  { ...BUTTON_DEFAULTS.dark,  ...(saved.dark  ?? {}) },
      light: { ...BUTTON_DEFAULTS.light, ...(saved.light ?? {}) },
    };
  } catch {
    return BUTTON_DEFAULTS;
  }
}

const VARIANTS = ['primary', 'secondary', 'danger', 'ghost', 'icon'];

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
