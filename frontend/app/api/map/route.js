import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

const GQL = 'https://api.rasayesh.com/graphql';

const GET_WEBSITE_EVENT = `
  query GetWebsiteEvent {
    websiteEvent {
      short_title_fa
      short_title_en
      bare_plan
      plan_styles
      map_bounds { x y }
      halls {
        id
        name
        color
        map_bounds { x y }
        booths {
          id
          no
          area
          type
          status
          bounds { x y }
          company {
            id
            slug
            logo
            brand_name_fa
            brand_name_en
            legal_name_fa
            legal_name_en
            field_of_activities { title_fa title_en }
            sponsorshipLevels { title_fa title_en color icon is_digital }
            eventOptions { show_profile }
          }
        }
      }
      map_signs {
        id
        coords { x y }
        title_fa
        title_en
        icon
        color
      }
    }
  }
`;

// ── Layer 1: admin-editable local config — tag-based, on-demand revalidation ──
// One unstable_cache per logical group (not one giant tag), matching the
// iph-apn admin routes 1:1 — see PERFORMANCE_AUDIT.md section 3's "split it"
// recommendation, so changing one setting (e.g. a door position) doesn't
// invalidate everything else (e.g. nav camera config). 300s is a safety-net
// ceiling only; the primary path is revalidateTag(tag, {expire:0}) from the
// corresponding admin save handler.

const getCachedHallColors = unstable_cache(
  async (eventId) => {
    const r = await query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'map_hall_colors'", [eventId]);
    return r.rows[0]?.value ?? {};
  },
  ['map-hall-colors'],
  { tags: ['map-hall-colors'], revalidate: 300 }
);

const getCachedMapElements = unstable_cache(
  async (eventId) => {
    try {
      const r = await query(
        'SELECT id, title_fa, title_en, icon_type, icon_value, color, x, y, sort_order, floor, linked_element_id FROM map_elements WHERE is_active = true AND event_id = $1 ORDER BY sort_order, id',
        [eventId]
      );
      return r.rows;
    } catch {
      return []; // table may not exist yet
    }
  },
  ['map-elements'],
  { tags: ['map-elements'], revalidate: 300 }
);

const getCachedMapDoors = unstable_cache(
  async (eventId) => {
    try {
      const r = await query(
        'SELECT id, door_type, x, y, hall_name, width FROM map_doors WHERE is_active = true AND event_id = $1',
        [eventId]
      );
      return r.rows;
    } catch {
      return [];
    }
  },
  ['map-doors'],
  { tags: ['map-doors'], revalidate: 300 }
);

const getCachedHallFloors = unstable_cache(
  async (eventId) => {
    try {
      const r = await query('SELECT hall_name, floor FROM map_hall_floors WHERE event_id = $1', [eventId]);
      return Object.fromEntries(r.rows.map(row => [row.hall_name, row.floor]));
    } catch {
      return {};
    }
  },
  ['map-hall-floors'],
  { tags: ['map-hall-floors'], revalidate: 300 }
);

const getCachedMapZones = unstable_cache(
  async (eventId) => {
    try {
      const r = await query(
        "SELECT id, title_fa, title_en, hall_name, shape_type, x1, y1, x2, y2, cx, cy, radius, points, is_blocking, is_visible FROM map_zones WHERE is_active = true AND event_id = $1",
        [eventId]
      );
      return r.rows;
    } catch {
      return [];
    }
  },
  ['map-zones'],
  { tags: ['map-zones'], revalidate: 300 }
);

const getCachedMapWalls = unstable_cache(
  async (eventId) => {
    try {
      const r = await query('SELECT id, hall_name, points FROM map_walls WHERE is_active = true AND event_id = $1', [eventId]);
      return r.rows;
    } catch {
      return [];
    }
  },
  ['map-walls'],
  { tags: ['map-walls'], revalidate: 300 }
);

const NAV_CAMERA_DEFAULTS = { distance: 220, height: 90, walk_speed: 75, stair_transition_duration: 0.8, arrival_fov_gain: 0 };
const getCachedNavCameraConfig = unstable_cache(
  async (eventId) => {
    const r = await query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'nav_camera_config'", [eventId]);
    return { ...NAV_CAMERA_DEFAULTS, ...(r.rows[0]?.value ?? {}) };
  },
  ['map-nav-camera'],
  { tags: ['map-nav-camera'], revalidate: 300 }
);

const NAV_MARKER_ICONS_DEFAULTS = {
  route_start: { type: 'builtin', value: '🏁' },
  route_end: { type: 'builtin', value: '📍' },
  door_entrance: { type: 'builtin', value: '🚶' },
  door_exit: { type: 'builtin', value: '🚪' },
  door_bidirectional: { type: 'builtin', value: '↔️' },
};
const getCachedNavMarkerIcons = unstable_cache(
  async (eventId) => {
    const r = await query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'nav_marker_icons_config'", [eventId]);
    return { ...NAV_MARKER_ICONS_DEFAULTS, ...(r.rows[0]?.value ?? {}) };
  },
  ['map-nav-markers'],
  { tags: ['map-nav-markers'], revalidate: 300 }
);

const MAP_APPEARANCE_CAM_DEFAULTS = { pitch: 50, distance: 1.0, heading: 86 };
const MAP_APPEARANCE_BG_DEFAULTS = { dark: '#021f20', light: '#e8f5f0' };
const getCachedMapAppearanceConfig = unstable_cache(
  async (eventId) => {
    const r = await query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'map_appearance_config'", [eventId]);
    const stored = r.rows[0]?.value ?? {};
    return {
      default_camera: { ...MAP_APPEARANCE_CAM_DEFAULTS, ...(stored.default_camera ?? {}) },
      background: { ...MAP_APPEARANCE_BG_DEFAULTS, ...(stored.background ?? {}) },
    };
  },
  ['map-appearance'],
  { tags: ['map-appearance'], revalidate: 300 }
);

const GESTURE_HINT_DEFAULTS = {
  enabled: true,
  display_mode: 'once',
  fa: '☝️ یک انگشت: جابجایی نقشه\n✌️ دو انگشت: چرخش و زوم',
  en: '☝️ One finger: move map\n✌️ Two fingers: rotate + zoom',
};
const getCachedGestureHintConfig = unstable_cache(
  async (eventId) => {
    const r = await query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'map_gesture_hint_config'", [eventId]);
    return { ...GESTURE_HINT_DEFAULTS, ...(r.rows[0]?.value ?? {}) };
  },
  ['map-gesture-hint'],
  { tags: ['map-gesture-hint'], revalidate: 300 }
);

const CONTROL_ICONS_DEFAULTS = {
  light: { zoomIn: null, zoomOut: null, compass: null },
  dark: { zoomIn: null, zoomOut: null, compass: null },
};
const getCachedControlIconsConfig = unstable_cache(
  async (eventId) => {
    const r = await query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'map_control_icons_config'", [eventId]);
    const stored = r.rows[0]?.value ?? {};
    return {
      light: { ...CONTROL_ICONS_DEFAULTS.light, ...(stored.light ?? {}) },
      dark: { ...CONTROL_ICONS_DEFAULTS.dark, ...(stored.dark ?? {}) },
    };
  },
  ['map-control-icons'],
  { tags: ['map-control-icons'], revalidate: 300 }
);

const GESTURE_HINT_IMAGES_DEFAULTS = {
  light: { oneFinger: null, twoFinger: null },
  dark: { oneFinger: null, twoFinger: null },
};
const getCachedGestureHintImagesConfig = unstable_cache(
  async (eventId) => {
    const r = await query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'map_gesture_hint_images_config'", [eventId]);
    const stored = r.rows[0]?.value ?? {};
    return {
      light: { ...GESTURE_HINT_IMAGES_DEFAULTS.light, ...(stored.light ?? {}) },
      dark: { ...GESTURE_HINT_IMAGES_DEFAULTS.dark, ...(stored.dark ?? {}) },
    };
  },
  ['map-gesture-hint-images'],
  { tags: ['map-gesture-hint-images'], revalidate: 300 }
);

// Keyed by icon name (not by theme, unlike CONTROL_ICONS/GESTURE_HINT_IMAGES
// above) -- each icon carries its own {icon, icon_size, color_dark,
// color_light}, same shape as quest_content_blocks' icon_tab_* blocks, so
// the admin UI can offer emoji/upload/SVG-with-color instead of just two
// raster uploads per theme.
const HEADER_ICONS_DEFAULTS = {
  companiesList: { icon: '🏢', icon_size: 20, color_dark: null, color_light: null },
};
const getCachedHeaderIconsConfig = unstable_cache(
  async (eventId) => {
    const r = await query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'map_header_icons_config'", [eventId]);
    const stored = r.rows[0]?.value ?? {};
    const config = {};
    for (const name of Object.keys(HEADER_ICONS_DEFAULTS)) {
      config[name] = { ...HEADER_ICONS_DEFAULTS[name], ...(stored[name] ?? {}) };
    }
    return config;
  },
  ['map-header-icons'],
  { tags: ['map-header-icons'], revalidate: 300 }
);

const ROUTE_APPEARANCE_DEFAULTS = {
  dark: {
    primary: { routeLine: '#00ffb3', routeArrow: '#00ffb3', walkthroughHalo: '#00ffb3', walkthroughStripe: '#00ffb3' },
    secondary: { routeLine: '#f59e0b', routeArrow: '#f59e0b', walkthroughHalo: '#f59e0b', walkthroughStripe: '#f59e0b' },
  },
  light: {
    primary: { routeLine: '#007755', routeArrow: '#007755', walkthroughHalo: '#007755', walkthroughStripe: '#007755' },
    secondary: { routeLine: '#d97706', routeArrow: '#d97706', walkthroughHalo: '#d97706', walkthroughStripe: '#d97706' },
  },
};
const getCachedRouteAppearanceConfig = unstable_cache(
  async (eventId) => {
    const r = await query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'route_appearance_config'", [eventId]);
    const stored = r.rows[0]?.value ?? {};
    // Migrate old flat format { dark: { routeLine, ... } } → new nested { dark: { primary: {...}, secondary: {...} } }
    const config = {};
    for (const theme of ['dark', 'light']) {
      const s = stored[theme] ?? {};
      if (s.primary || s.secondary) {
        config[theme] = {
          primary: { ...ROUTE_APPEARANCE_DEFAULTS[theme].primary, ...(s.primary ?? {}) },
          secondary: { ...ROUTE_APPEARANCE_DEFAULTS[theme].secondary, ...(s.secondary ?? {}) },
        };
      } else {
        const promoted = {};
        for (const f of ['routeLine', 'routeArrow', 'walkthroughHalo', 'walkthroughStripe']) {
          if (s[f]) promoted[f] = s[f];
        }
        config[theme] = {
          primary: { ...ROUTE_APPEARANCE_DEFAULTS[theme].primary, ...promoted },
          secondary: { ...ROUTE_APPEARANCE_DEFAULTS[theme].secondary },
        };
      }
    }
    return config;
  },
  ['map-route-appearance'],
  { tags: ['map-route-appearance'], revalidate: 300 }
);

const getCachedMapLabelsConfig = unstable_cache(
  async (eventId) => {
    const r = await query("SELECT value FROM app_settings WHERE event_id = $1 AND key = 'map_labels_config'", [eventId]);
    return r.rows[0]?.value ?? null;
  },
  ['map-labels'],
  { tags: ['map-labels'], revalidate: 300 }
);

// ── Layer 2: Rasayesh-sourced websiteEvent — short TTL, no admin edit signal ──
// halls/booths/booth->company mapping is external, live Rasayesh data, same
// as the companies-data tier-2 work. 60s TTL: booth->company assignments can
// be corrected by Rasayesh-side staff during a live event same as company
// profile edits, so this uses the same window as /api/companies/data rather
// than getRasayeshEventInfo's 5-minute TTL (which is for near-static event
// metadata). map/settings' event_origin PUT (iph-apn) revalidates this tag
// too, since changing which event's map data is shown is a direct, immediate
// admin action even though the map DATA itself isn't admin-editable.
const WEBSITE_EVENT_TTL = 60;
const getCachedWebsiteEvent = unstable_cache(
  async (eventOrigin) => {
    const res = await fetch(GQL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rasayesh-site': 'iph',
        origin: eventOrigin,
        referer: `${eventOrigin}/`,
      },
      body: JSON.stringify({ query: GET_WEBSITE_EVENT }),
      signal: AbortSignal.timeout(12000),
    });
    const json = await res.json();
    if (json.errors?.length) {
      console.error('[api/map] GraphQL errors:', JSON.stringify(json.errors, null, 2));
      return { websiteEvent: null, errors: json.errors };
    }
    return { websiteEvent: json.data?.websiteEvent ?? null };
  },
  ['map-website-event'],
  { tags: ['map-website-event'], revalidate: WEBSITE_EVENT_TTL }
);

export async function GET() {
  try {
    // Prefer map_config; fall back to companies_config for backward compat.
    // Not itself cached -- it's a tiny scalar read only used to pick which
    // Rasayesh origin Layer 2 queries, not returned to the client as content.
    const currentEventId = await getCurrentEventId();
    const mapResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'map_config'",
      [currentEventId]
    );
    let eventOrigin = mapResult.rows[0]?.value?.event_origin;
    let rasayeshEventId = mapResult.rows[0]?.value?.event_id;
    if (!eventOrigin || !rasayeshEventId) {
      const fallback = await query(
        "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'companies_config'",
        [currentEventId]
      );
      eventOrigin = eventOrigin ?? fallback.rows[0]?.value?.event_origin ?? 'https://2025.iphexpo.com';
      rasayeshEventId = rasayeshEventId ?? fallback.rows[0]?.value?.event_id ?? null;
    }
    // Admin-configured per-event override (iph-apn map settings tab) -- when
    // set, MapClient embeds this URL instead of deriving /plan/<id>/224 from
    // rasayeshEventId above. Same uncached row as event_origin/rasayeshEventId,
    // no separate query needed.
    const external3dEnabled = mapResult.rows[0]?.value?.external_3d_enabled === true;
    const external3dUrl = mapResult.rows[0]?.value?.external_3d_url || null;

    // Preserves the original control flow exactly: Rasayesh is fetched and
    // checked FIRST, with an early return on error, before any local config
    // is read — same as before caching was added, not merged into a single
    // Promise.all (which would change error-propagation behavior).
    const { websiteEvent, errors } = await getCachedWebsiteEvent(eventOrigin);
    if (errors) {
      return NextResponse.json({ websiteEvent: null, errors });
    }

    const [
      hallColors,
      mapElements,
      mapDoors,
      hallFloors,
      mapZones,
      mapWalls,
      navCameraConfig,
      navMarkerIcons,
      mapAppearanceConfig,
      gestureHintConfig,
      controlIconsConfig,
      gestureHintImagesConfig,
      routeAppearanceConfig,
      mapLabelsConfig,
      headerIconsConfig,
    ] = await Promise.all([
      getCachedHallColors(currentEventId),
      getCachedMapElements(currentEventId),
      getCachedMapDoors(currentEventId),
      getCachedHallFloors(currentEventId),
      getCachedMapZones(currentEventId),
      getCachedMapWalls(currentEventId),
      getCachedNavCameraConfig(currentEventId),
      getCachedNavMarkerIcons(currentEventId),
      getCachedMapAppearanceConfig(currentEventId),
      getCachedGestureHintConfig(currentEventId),
      getCachedControlIconsConfig(currentEventId),
      getCachedGestureHintImagesConfig(currentEventId),
      getCachedRouteAppearanceConfig(currentEventId),
      getCachedMapLabelsConfig(currentEventId),
      getCachedHeaderIconsConfig(currentEventId),
    ]);

    return NextResponse.json({
      websiteEvent,
      rasayeshEventId,
      external_3d_enabled: external3dEnabled,
      external_3d_url: external3dUrl,
      hallColors,
      mapElements,
      mapDoors,
      hallFloors,
      mapZones,
      mapWalls,
      navCameraConfig,
      navMarkerIcons,
      mapAppearanceConfig,
      gestureHintConfig,
      controlIconsConfig,
      gestureHintImagesConfig,
      routeAppearanceConfig,
      mapLabelsConfig,
      headerIconsConfig,
    });
  } catch (err) {
    console.error('[api/map]', err.message);
    return NextResponse.json({ websiteEvent: null });
  }
}
