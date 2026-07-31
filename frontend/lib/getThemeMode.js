import 'server-only';
import { query } from './db';

const VALID = new Set(['system', 'dark', 'light']);

export async function getThemeMode() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'appearance_config'");
    const mode = result.rows[0]?.value?.theme_mode;
    return VALID.has(mode) ? mode : 'system';
  } catch {
    return 'system';
  }
}
