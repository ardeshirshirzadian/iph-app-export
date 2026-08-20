import 'server-only';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';

const VALID = new Set(['system', 'dark', 'light']);

// eventId: pass explicitly from inside an unstable_cache-wrapped call site --
// see lib/getActiveFont.js for why.
export async function getThemeMode(eventId) {
  try {
    eventId = eventId ?? await getCurrentEventId();
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'appearance_config'",
      [eventId]
    );
    const mode = result.rows[0]?.value?.theme_mode;
    return VALID.has(mode) ? mode : 'system';
  } catch {
    return 'system';
  }
}
