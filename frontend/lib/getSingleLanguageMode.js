import 'server-only';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';

// eventId: pass explicitly from inside an unstable_cache-wrapped call site --
// see lib/getActiveFont.js for why. Mirrors lib/getThemeMode.js exactly --
// same app_settings key, same shape, same reasoning for accepting eventId.
export async function getSingleLanguageMode(eventId) {
  try {
    eventId = eventId ?? await getCurrentEventId();
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'appearance_config'",
      [eventId]
    );
    return result.rows[0]?.value?.single_language === true;
  } catch {
    return false;
  }
}
