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
        'SELECT id, title_fa, title_en, icon_type, icon_value, color, x, y, sort_order FROM map_elements WHERE is_active = true ORDER BY sort_order, id'
      );
      mapElements = elementsResult.rows;
    } catch {
      // table may not exist yet — safe to ignore
    }

    return NextResponse.json({
      websiteEvent: json.data?.websiteEvent ?? null,
      hallColors,
      mapElements,
    });
  } catch (err) {
    console.error('[api/map]', err.message);
    return NextResponse.json({ websiteEvent: null });
  }
}
