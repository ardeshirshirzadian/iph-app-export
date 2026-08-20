import 'server-only';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';

const DEFAULT_IDENTITY = {
  title: 'Iranpharma',
  short_name: 'IPH',
  description: 'Iran Pharma Exhibition Super App',
};

// eventId: pass explicitly from inside an unstable_cache-wrapped call site
// (see app/layout.js) -- see getActiveFont.js for why.
export async function getAppIdentity(eventId) {
  try {
    eventId = eventId ?? await getCurrentEventId();
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'app_identity'",
      [eventId]
    );
    if (result.rows.length === 0) return DEFAULT_IDENTITY;
    const stored = result.rows[0].value;
    return { ...DEFAULT_IDENTITY, ...stored };
  } catch (err) {
    console.error('getAppIdentity error:', err);
    return DEFAULT_IDENTITY;
  }
}
