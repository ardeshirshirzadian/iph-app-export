import 'server-only';
import { query } from './db';
import { scanFonts } from './fontScanner';

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

async function loadFontFromDb(settingsKey, defaultFont) {
  const result = await query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [settingsKey]
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

export async function getActiveFont() {
  try {
    return await loadFontFromDb('active_font', DEFAULT_FONT);
  } catch (err) {
    console.error('getActiveFont error:', err);
    return DEFAULT_FONT;
  }
}

export async function getActiveFontEn() {
  try {
    return await loadFontFromDb('active_font_en', DEFAULT_FONT_EN);
  } catch (err) {
    console.error('getActiveFontEn error:', err);
    return DEFAULT_FONT_EN;
  }
}
