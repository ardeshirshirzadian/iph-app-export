import { readdirSync } from 'fs';
import { join, extname, relative } from 'path';

const FONT_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf']);

const FORMAT_MAP = {
  '.woff2': 'woff2',
  '.woff': 'woff',
  '.ttf': 'truetype',
  '.otf': 'opentype',
};

const FORMAT_ORDER = { woff2: 0, woff: 1, truetype: 2, opentype: 3 };

// Ordered longest-first to avoid partial matches (e.g. "extrabold" before "bold")
const WEIGHT_KEYWORDS = [
  ['extralight', 200], ['ultralight', 200],
  ['extrabold', 800], ['ultrabold', 800],
  ['semibold', 600], ['demibold', 600],
  ['hairline', 100],
  ['thin', 100],
  ['light', 300],
  ['medium', 500],
  ['regular', 400],
  ['bold', 700],
  ['black', 900],
  ['heavy', 900],
];

function parseFilename(basename) {
  const lastDash = basename.lastIndexOf('-');
  if (lastDash !== -1) {
    const prefix = basename.slice(0, lastDash);
    const suffix = basename.slice(lastDash + 1).toLowerCase();
    for (const [keyword, weight] of WEIGHT_KEYWORDS) {
      if (suffix === keyword) return { familyName: prefix, weight };
    }
  }
  return { familyName: basename, weight: 400 };
}

function collectFiles(dir, fontsAbsDir, files) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, fontsAbsDir, files);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (FONT_EXTENSIONS.has(ext)) {
        const basename = entry.name.slice(0, -ext.length);
        const { familyName, weight } = parseFilename(basename);
        const rel = relative(fontsAbsDir, fullPath).replace(/\\/g, '/');
        files.push({
          path: `/fonts/${rel}`,
          filename: entry.name,
          familyName,
          weight,
          format: FORMAT_MAP[ext] || ext.slice(1),
        });
      }
    }
  }
}

export function scanFonts() {
  const fontsAbsDir = join(process.cwd(), 'public', 'fonts');
  const allFiles = [];
  collectFiles(fontsAbsDir, fontsAbsDir, allFiles);

  const familyMap = new Map();
  for (const file of allFiles) {
    if (!familyMap.has(file.familyName)) familyMap.set(file.familyName, []);
    familyMap.get(file.familyName).push(file);
  }

  const families = [];
  for (const [familyName, files] of familyMap) {
    files.sort((a, b) => {
      if (a.weight !== b.weight) return a.weight - b.weight;
      return (FORMAT_ORDER[a.format] ?? 9) - (FORMAT_ORDER[b.format] ?? 9);
    });
    families.push({ familyName, displayName: familyName, files });
  }

  families.sort((a, b) => a.familyName.localeCompare(b.familyName));
  return families;
}
