import 'server-only';
import { query } from './db';
import { scanFonts } from './fontScanner';
import { getCurrentEventId } from './currentEvent';

const DEFAULT_FONT = {
  family: 'Vazirmatn',
  displayName: 'Vazirmatn',
  weight: 400,
  file: null,
  allFiles: [],
  source: 'google',
  googleUrl:
    'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;700&display=swap',
};

const DEFAULT_FONT_EN = {
  family: 'Inter',
  displayName: 'Inter',
  weight: 400,
  file: null,
  allFiles: [],
  source: 'google',
  googleUrl:
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;700&display=swap',
};

async function loadFontFromDb(settingsKey, defaultFont, eventId) {
  eventId = eventId ?? await getCurrentEventId();
  const result = await query(
    `SELECT value FROM app_settings WHERE event_id = $1 AND key = $2`,
    [eventId, settingsKey]
  );
  if (result.rows.length === 0) return defaultFont;

  const stored = result.rows[0].value;
  if (!stored?.family) return defaultFont;

  const families = scanFonts();
  const familyData = families.find((f) => f.familyName === stored.family);

  // Deduplicate: take one file per weight (scanner already sorts woff2-first per weight)
  const allFiles = [];
  const seen = new Set();
  for (const f of familyData?.files ?? []) {
    if (!seen.has(f.weight)) {
      seen.add(f.weight);
      allFiles.push(f);
    }
  }

  // If scanner found no files for this family (e.g. font was deleted), fall back to the
  // single stored file so the CSS variable still resolves to something visible.
  if (allFiles.length === 0 && stored.file) {
    allFiles.push({ path: stored.file, format: 'woff2', weight: stored.weight ?? 400 });
  }

  return {
    family: stored.family,
    displayName: stored.displayName || stored.family,
    weight: stored.weight ?? 400,
    file: stored.file,
    allFiles,
    source: 'local',
  };
}

// eventId: pass explicitly when calling from inside an unstable_cache-wrapped
// function (see app/layout.js) -- getCurrentEventId() reads next/headers,
// which unstable_cache does not support accessing internally. Omit it for
// any direct/unwrapped call site, where resolving it here is still correct.
export async function getActiveFont(eventId) {
  try {
    return await loadFontFromDb('active_font', DEFAULT_FONT, eventId);
  } catch (err) {
    console.error('getActiveFont error:', err);
    return DEFAULT_FONT;
  }
}

export async function getActiveFontEn(eventId) {
  try {
    return await loadFontFromDb('active_font_en', DEFAULT_FONT_EN, eventId);
  } catch (err) {
    console.error('getActiveFontEn error:', err);
    return DEFAULT_FONT_EN;
  }
}
