import 'server-only';

// Server-side companion to formOptionsCache.js. The browser cache cannot be
// imported by route handlers (it depends on the browser Apollo client), so
// keep one small, canonical-options cache here for leaderboard rendering.
// This deliberately queries Rasayesh's occupation options rather than
// copying a second list into the app.
const RASAYESH_GRAPHQL = 'https://api.rasayesh.com/graphql';
const ATTENDEE_ORIGIN = 'https://attendee.rasayesh.com';
const OCCUPATIONS_QUERY = `
  query LeaderboardOccupations {
    occupations(industryId: 1) { id title_fa title_en }
  }
`;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedLabels = null;
let cacheExpiresAt = 0;
let loadingLabels = null;

function cleanLabel(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function loadLabels() {
  const response = await fetch(RASAYESH_GRAPHQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Match formOptionsCache's authenticated attendee-side source. These
      // are public canonical form options; no attendee data is requested.
      'x-rasayesh-site': 'attendee',
      origin: ATTENDEE_ORIGIN,
      referer: `${ATTENDEE_ORIGIN}/`,
      lang: 'fa',
    },
    body: JSON.stringify({ query: OCCUPATIONS_QUERY }),
  });
  if (!response.ok) throw new Error(`Occupation options request failed (${response.status})`);

  const payload = await response.json();
  if (payload?.errors?.length) throw new Error(payload.errors[0]?.message || 'Occupation options query failed');

  const labels = new Map();
  for (const occupation of payload?.data?.occupations ?? []) {
    if (occupation?.id === null || occupation?.id === undefined) continue;
    const fa = cleanLabel(occupation.title_fa) || cleanLabel(occupation.title_en);
    const en = cleanLabel(occupation.title_en) || cleanLabel(occupation.title_fa);
    if (fa || en) labels.set(String(occupation.id), { fa, en });
  }
  return labels;
}

async function getCachedLabels() {
  if (cachedLabels && cacheExpiresAt > Date.now()) return cachedLabels;
  if (!loadingLabels) {
    loadingLabels = loadLabels()
      .then((labels) => {
        cachedLabels = labels;
        cacheExpiresAt = Date.now() + CACHE_TTL_MS;
        return labels;
      })
      .finally(() => { loadingLabels = null; });
  }
  return loadingLabels;
}

// Returns only safe display labels for the supplied IDs. Lookup errors are
// intentionally swallowed so an unavailable Rasayesh options endpoint can
// never make a leaderboard request fail.
export async function resolveOccupationLabels(occupationIds) {
  const ids = [...new Set((occupationIds ?? [])
    .filter((id) => id !== null && id !== undefined && String(id).trim())
    .map((id) => String(id)))];
  if (ids.length === 0) return new Map();

  try {
    const labels = await getCachedLabels();
    return new Map(ids.map((id) => [id, labels.get(id) || null]));
  } catch (err) {
    console.warn('[occupationResolver]', err.message);
    return new Map();
  }
}
