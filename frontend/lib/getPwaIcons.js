import 'server-only';
import { existsSync } from 'fs';
import { join } from 'path';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';

const LEGACY_DIR = join(process.cwd(), 'public', 'uploads', 'icons');

// No bundled static default ever existed for apple-touch-icon (layout.js
// used to hardcode a link straight to /uploads/icons/apple-touch-icon.png
// with no existence check at all -- a guaranteed 404 for any event that
// never uploaded one). null here means "render no <link> tag", which is
// strictly better than linking to a file that isn't there.
const STATIC_DEFAULTS = {
  'icon-192': '/icons/icon-192.png',
  'icon-512': '/icons/icon-512.png',
  favicon: '/icons/favicon-default.ico',
  'apple-touch-icon': null,
};

// Legacy on-disk filename each variant used before this fix, when every
// event shared the exact same global /uploads/icons/<name> path.
const LEGACY_FILENAMES = {
  'icon-192': 'icon-192.png',
  'icon-512': 'icon-512.png',
  favicon: 'favicon.png',
  'apple-touch-icon': 'apple-touch-icon.png',
};

// Resolves this event's own uploaded PWA icon/favicon paths.
// app_settings.pwa_icons (event-scoped, written by iph-apn's
// upload-icon/route.js) is checked first; a variant missing from it falls
// back, independently, to the OLD shared-global file at
// /uploads/icons/<variant>.png -- so an event that customized these before
// this fix shipped (or just hasn't re-uploaded since) keeps showing exactly
// what it did before, rather than reverting to the bundled default -- and
// finally to the bundled static default (or null) if neither exists.
//
// eventId: pass explicitly from inside an unstable_cache-wrapped call site
// -- see lib/getActiveFont.js for why.
export async function getPwaIcons(eventId) {
  eventId = eventId ?? (await getCurrentEventId());

  let stored = null;
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'pwa_icons'",
      [eventId]
    );
    stored = result.rows[0]?.value ?? null;
  } catch (err) {
    console.error('getPwaIcons error:', err);
  }

  function resolve(variant) {
    if (stored?.[variant]) return stored[variant];
    if (existsSync(join(LEGACY_DIR, LEGACY_FILENAMES[variant]))) {
      return `/uploads/icons/${LEGACY_FILENAMES[variant]}`;
    }
    return STATIC_DEFAULTS[variant];
  }

  return {
    'icon-192': resolve('icon-192'),
    'icon-512': resolve('icon-512'),
    favicon: resolve('favicon'),
    'apple-touch-icon': resolve('apple-touch-icon'),
  };
}
