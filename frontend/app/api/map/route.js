import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

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

export async function GET() {
  try {
    // Prefer map_config; fall back to companies_config for backward compat
    const mapResult = await query("SELECT value FROM app_settings WHERE key = 'map_config'");
    let eventOrigin = mapResult.rows[0]?.value?.event_origin;
    if (!eventOrigin) {
      const fallback = await query("SELECT value FROM app_settings WHERE key = 'companies_config'");
      eventOrigin = fallback.rows[0]?.value?.event_origin ?? 'https://2025.iphexpo.com';
    }

    const res = await fetch(GQL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rasayesh-site': 'iph',
        origin: eventOrigin,
        referer: `${eventOrigin}/`,
      },
      body: JSON.stringify({ query: GET_WEBSITE_EVENT }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });

    const json = await res.json();

    if (json.errors?.length) {
      console.error('[api/map] GraphQL errors:', JSON.stringify(json.errors, null, 2));
      return NextResponse.json({ websiteEvent: null, errors: json.errors });
    }

    const hallColorsResult = await query("SELECT value FROM app_settings WHERE key = 'map_hall_colors'");
    const hallColors = hallColorsResult.rows[0]?.value ?? {};

    let mapElements = [];
    try {
      const elementsResult = await query(
        'SELECT id, title_fa, title_en, icon_type, icon_value, color, x, y, sort_order, floor, linked_element_id FROM map_elements WHERE is_active = true ORDER BY sort_order, id'
      );
      mapElements = elementsResult.rows;
    } catch {
      // table may not exist yet — safe to ignore
    }

    let mapDoors = [];
    try {
      const doorsResult = await query(
        'SELECT id, door_type, x, y, hall_name, width FROM map_doors WHERE is_active = true'
      );
      mapDoors = doorsResult.rows;
    } catch {
      // table may not exist yet — safe to ignore
    }

    let hallFloors = {};
    try {
      const floorsResult = await query('SELECT hall_name, floor FROM map_hall_floors');
      hallFloors = Object.fromEntries(floorsResult.rows.map(r => [r.hall_name, r.floor]));
    } catch {
      // table may not exist yet — safe to ignore; default 0 applied client-side
    }

    let mapZones = [];
    try {
      const zonesResult = await query(
        "SELECT id, title_fa, title_en, hall_name, shape_type, x1, y1, x2, y2, cx, cy, radius, points, is_blocking, is_visible FROM map_zones WHERE is_active = true"
      );
      mapZones = zonesResult.rows;
    } catch {
      // table may not exist yet — safe to ignore
    }

    let mapWalls = [];
    try {
      const wallsResult = await query(
        'SELECT id, hall_name, points FROM map_walls WHERE is_active = true'
      );
      mapWalls = wallsResult.rows;
    } catch {
      // table may not exist yet — safe to ignore
    }

    const navCamResult = await query("SELECT value FROM app_settings WHERE key = 'nav_camera_config'");
    const navCameraConfig = { distance: 220, height: 90, walk_speed: 75, stair_transition_duration: 0.8, ...(navCamResult.rows[0]?.value ?? {}) };

    const navMarkersResult = await query("SELECT value FROM app_settings WHERE key = 'nav_marker_icons_config'");
    const navMarkerIconsDefaults = {
      route_start: { type: 'builtin', value: '🏁' },
      route_end: { type: 'builtin', value: '📍' },
      door_entrance: { type: 'builtin', value: '🚶' },
      door_exit: { type: 'builtin', value: '🚪' },
      door_bidirectional: { type: 'builtin', value: '↔️' },
    };
    const navMarkerIcons = { ...navMarkerIconsDefaults, ...(navMarkersResult.rows[0]?.value ?? {}) };

    const MAP_APPEARANCE_CAM_DEFAULTS = { pitch: 50, distance: 1.0, heading: 86 };
    const MAP_APPEARANCE_BG_DEFAULTS  = { dark: '#021f20', light: '#e8f5f0' };
    const appearanceResult = await query("SELECT value FROM app_settings WHERE key = 'map_appearance_config'");
    const appearanceStored = appearanceResult.rows[0]?.value ?? {};
    const mapAppearanceConfig = {
      default_camera: { ...MAP_APPEARANCE_CAM_DEFAULTS, ...(appearanceStored.default_camera ?? {}) },
      background:     { ...MAP_APPEARANCE_BG_DEFAULTS,  ...(appearanceStored.background     ?? {}) },
    };

    const GESTURE_HINT_DEFAULTS = {
      enabled: true,
      fa: '☝️ یک انگشت: جابجایی نقشه\n✌️ دو انگشت: چرخش و زوم',
      en: '☝️ One finger: move map\n✌️ Two fingers: rotate + zoom',
    };
    const gestureHintResult = await query("SELECT value FROM app_settings WHERE key = 'map_gesture_hint_config'");
    const gestureHintConfig = { ...GESTURE_HINT_DEFAULTS, ...(gestureHintResult.rows[0]?.value ?? {}) };

    const ROUTE_APPEARANCE_DEFAULTS = {
      dark: {
        primary:   { routeLine: '#00ffb3', routeArrow: '#00ffb3', walkthroughHalo: '#00ffb3', walkthroughStripe: '#00ffb3' },
        secondary: { routeLine: '#f59e0b', routeArrow: '#f59e0b', walkthroughHalo: '#f59e0b', walkthroughStripe: '#f59e0b' },
      },
      light: {
        primary:   { routeLine: '#007755', routeArrow: '#007755', walkthroughHalo: '#007755', walkthroughStripe: '#007755' },
        secondary: { routeLine: '#d97706', routeArrow: '#d97706', walkthroughHalo: '#d97706', walkthroughStripe: '#d97706' },
      },
    };
    const routeAppearanceResult = await query("SELECT value FROM app_settings WHERE key = 'route_appearance_config'");
    const routeAppearanceStored = routeAppearanceResult.rows[0]?.value ?? {};
    // Migrate old flat format { dark: { routeLine, ... } } → new nested { dark: { primary: {...}, secondary: {...} } }
    const routeAppearanceConfig = {};
    for (const theme of ['dark', 'light']) {
      const s = routeAppearanceStored[theme] ?? {};
      if (s.primary || s.secondary) {
        routeAppearanceConfig[theme] = {
          primary:   { ...ROUTE_APPEARANCE_DEFAULTS[theme].primary,   ...(s.primary   ?? {}) },
          secondary: { ...ROUTE_APPEARANCE_DEFAULTS[theme].secondary, ...(s.secondary ?? {}) },
        };
      } else {
        // Old flat format — promote to primary, defaults for secondary
        const promoted = {};
        for (const f of ['routeLine', 'routeArrow', 'walkthroughHalo', 'walkthroughStripe']) {
          if (s[f]) promoted[f] = s[f];
        }
        routeAppearanceConfig[theme] = {
          primary:   { ...ROUTE_APPEARANCE_DEFAULTS[theme].primary,   ...promoted },
          secondary: { ...ROUTE_APPEARANCE_DEFAULTS[theme].secondary },
        };
      }
    }

    const mapLabelsResult = await query("SELECT value FROM app_settings WHERE key = 'map_labels_config'");
    const mapLabelsConfig = mapLabelsResult.rows[0]?.value ?? null;

    return NextResponse.json({
      websiteEvent: json.data?.websiteEvent ?? null,
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
      routeAppearanceConfig,
      mapLabelsConfig,
    });
  } catch (err) {
    console.error('[api/map]', err.message);
    return NextResponse.json({ websiteEvent: null });
  }
}
