import 'server-only';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';

const DEFAULT = { enabled: true, template: 'خوش آمدید، {name}!' };

// eventId: pass explicitly from inside an unstable_cache-wrapped call site --
// see lib/getActiveFont.js for why.
export async function getWelcomeToast(eventId) {
  try {
    eventId = eventId ?? await getCurrentEventId();
    const { rows } = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'welcome_toast'",
      [eventId]
    );
    if (!rows[0]?.value) return DEFAULT;
    return { ...DEFAULT, ...rows[0].value };
  } catch {
    return DEFAULT;
  }
}
