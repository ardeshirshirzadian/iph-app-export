import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getCachedCompaniesConfig } from '@/lib/getCompaniesConfig';
import { fetchPublicGraphQL } from '@/lib/publicRasayeshClient';
import { getCurrentEventId } from '@/lib/currentEvent';
import { query } from '@/lib/db';

// Company records live in Rasayesh (external CRM) -- this app's admin panel
// doesn't control them and has no "saved" event to hook a revalidateTag()
// call to (unlike companies_config, see lib/getCompaniesConfig.js). So this
// is a time-based TTL cache, not on-demand: 60s. Rationale -- during a live
// exhibition, exhibitors can edit their own company profile / booth
// assignment right up to and during the event, so this needs to be
// meaningfully shorter than getRasayeshEventInfo's existing 5-minute TTL
// (lib/publicRasayeshClient.js), which is for near-static event metadata.
// 60s still meaningfully cuts redundant Rasayesh calls for the highest-
// traffic pattern (default view, no search, repeat visits within the same
// minute) without letting a mid-event correction sit stale for long.
const RASAYESH_TTL = 60;

const COMPANIES_QUERY = `
  query EventCompanies($search: String, $orderBy: String, $eventId: Int) {
    eventCompanies(search: $search, orderBy: $orderBy, order: "asc", all: true, eventId: $eventId) {
      id slug legal_name_fa legal_name_en brand_name_fa brand_name_en
      logo description_fa description_en website
      booths(eventId: $eventId) { id no hall { id name } }
      eventOptions { show_profile }
    }
    eventCompaniesCount(search: $search, eventId: $eventId)
  }
`;

const SPONSORSHIP_LEVELS_QUERY = `
  query SponsorshipLevels($eventId: Int) {
    sponsorshipLevels(eventId: $eventId, orderBy: "order", order: "asc", all: true) {
      id
      title_fa
      title_en
      icon
      color
      sponsors { id }
    }
  }
`;

const FEATURE_QUERY = `
  query EventFeatureCompanies {
    eventFeatureCompanies {
      company {
        id slug legal_name_fa legal_name_en brand_name_fa brand_name_en logo
      }
    }
  }
`;

const EVENT_COMPANY_QUERY = `
  query EventCompany($slug: String, $eventId: Int) {
    eventCompany(slug: $slug, eventId: $eventId) {
      id
      slug
      legal_name_fa
      legal_name_en
      brand_name_fa
      brand_name_en
      logo
      description_fa
      description_en
      phones
      emails
      website
      address_fa
      address_en
      booths(eventId: $eventId) {
        id
        no
        hall { id name }
      }
      sponsorshipLevels {
        icon
        color
        title_fa
        title_en
      }
    }
  }
`;

const getCachedCompaniesList = unstable_cache(
  (search, orderBy, eventId, eventOrigin) => {
    const variables = {
      orderBy,
      ...(search ? { search } : {}),
      ...(eventId != null ? { eventId } : {}),
    };
    return fetchPublicGraphQL(COMPANIES_QUERY, variables, eventOrigin);
  },
  ['companies-rasayesh-list'],
  { tags: ['companies-rasayesh-data'], revalidate: RASAYESH_TTL }
);

const getCachedSponsorshipLevels = unstable_cache(
  (eventId, eventOrigin) =>
    fetchPublicGraphQL(SPONSORSHIP_LEVELS_QUERY, { eventId }, eventOrigin),
  ['companies-rasayesh-sponsorship'],
  { tags: ['companies-rasayesh-data'], revalidate: RASAYESH_TTL }
);

const getCachedFeaturedCompanies = unstable_cache(
  (eventOrigin) => fetchPublicGraphQL(FEATURE_QUERY, {}, eventOrigin),
  ['companies-rasayesh-featured'],
  { tags: ['companies-rasayesh-data'], revalidate: RASAYESH_TTL }
);

const getCachedCompanyDetail = unstable_cache(
  (slug, eventId, eventOrigin) => {
    const variables = { slug, ...(eventId != null ? { eventId } : {}) };
    return fetchPublicGraphQL(EVENT_COMPANY_QUERY, variables, eventOrigin);
  },
  ['companies-rasayesh-detail'],
  { tags: ['companies-rasayesh-data'], revalidate: RASAYESH_TTL }
);

// Subsidiary companies (e.g. داروپخش under تامین/تیپیکو) -- Rasayesh's own
// eventCompanies list and eventCompanies search never return them (they're
// only discoverable by walking a parent's `subsidiaries` field, which this
// app's own iph-apn sync already does into companies_placement), and
// eventCompany(slug:...) resolves null for one too (confirmed live
// 2026-09-12) unless it also happens to be independently registered for
// this event. So they're merged in here from the local sync, deliberately
// OUTSIDE the unstable_cache wrapper above -- normal companies keep their
// exact 60s live-Rasayesh freshness guarantee unchanged; subsidiary data
// only ever changes on our own admin-triggered sync, so a plain per-request
// query (sub-ms on the local Postgres socket, ~60 rows) needs no caching
// layer of its own.
//
// Shapes each row into the exact same raw JSON shape the corresponding
// Rasayesh query already returns, so CompaniesClient.jsx's mapCompany() and
// CompanyDetailClient.jsx need zero changes -- they only ever see "a raw
// eventCompanies/eventCompany entry", never where it came from. hall_name/
// booth_no are stored as plain text (already denormalized from the parent
// at sync time, see companiesSync.js) rather than Rasayesh's real booths[]
// array, so they're wrapped into a single synthetic booth entry here.
function shapeLocalSubsidiaryForList(row) {
  return {
    id: row.id,
    slug: row.slug,
    legal_name_fa: row.legal_name_fa,
    legal_name_en: row.legal_name_en,
    brand_name_fa: row.brand_name_fa,
    brand_name_en: row.brand_name_en,
    logo: row.logo,
    description_fa: row.description_fa,
    description_en: row.description_en,
    website: row.website,
    booths: (row.hall_name || row.booth_no)
      ? [{ hall: { name: row.hall_name }, no: row.booth_no }]
      : [],
    // Not a sponsor via inheritance -- a subsidiary only ever appears in a
    // sponsorMap lookup (built client-side from the separate sponsorship
    // query, keyed by this same global `id`) if it's independently a
    // sponsor, which matches how a normal company works too.
    eventOptions: { show_profile: true },
  };
}

function shapeLocalSubsidiaryForDetail(row) {
  return {
    id: row.id,
    slug: row.slug,
    legal_name_fa: row.legal_name_fa,
    legal_name_en: row.legal_name_en,
    brand_name_fa: row.brand_name_fa,
    brand_name_en: row.brand_name_en,
    logo: row.logo,
    description_fa: row.description_fa,
    description_en: row.description_en,
    phones: row.phones,
    emails: row.emails,
    website: row.website,
    address_fa: row.address_fa,
    address_en: row.address_en,
    booths: (row.hall_name || row.booth_no)
      ? [{ hall: { name: row.hall_name }, no: row.booth_no }]
      : [],
    // Empty, not inherited from the parent -- CompanyDetailClient.jsx derives
    // is_sponsor/sponsor_level from sponsorshipLevels.length, so this
    // correctly renders a subsidiary as not-a-sponsor unless it someday gets
    // its own real sponsorshipRequests synced (companiesSync.js already
    // checks each subsidiary's own sponsorshipRequests, not the parent's).
    sponsorshipLevels: [],
  };
}

async function fetchLocalSubsidiaries(currentEventId, rasayeshEventId, search) {
  if (!currentEventId || rasayeshEventId == null) return [];
  try {
    const { rows } = await query(
      `SELECT company_id AS id, slug, brand_name_fa, brand_name_en, legal_name_fa, legal_name_en,
              logo, website, description_fa, description_en, hall_name, booth_no
       FROM companies_placement
       WHERE event_id = $1 AND rasayesh_event_id = $2
         AND parent_company_id IS NOT NULL AND is_active = true
         AND ($3 = '' OR brand_name_fa ILIKE $4 OR brand_name_en ILIKE $4 OR legal_name_fa ILIKE $4)
       ORDER BY brand_name_fa ASC NULLS LAST`,
      [currentEventId, rasayeshEventId, search, `%${search}%`]
    );
    return rows.map(shapeLocalSubsidiaryForList);
  } catch (err) {
    console.error('[api/companies/data] local subsidiary list query failed:', err.message);
    return [];
  }
}

async function fetchLocalSubsidiaryDetail(currentEventId, rasayeshEventId, slug) {
  if (!currentEventId || rasayeshEventId == null) return null;
  try {
    const { rows } = await query(
      `SELECT company_id AS id, slug, brand_name_fa, brand_name_en, legal_name_fa, legal_name_en,
              logo, website, description_fa, description_en, phones, emails,
              address_fa, address_en, hall_name, booth_no
       FROM companies_placement
       WHERE event_id = $1 AND rasayesh_event_id = $2
         AND parent_company_id IS NOT NULL AND slug = $3 AND is_active = true
       LIMIT 1`,
      [currentEventId, rasayeshEventId, slug]
    );
    return rows[0] ? shapeLocalSubsidiaryForDetail(rows[0]) : null;
  } catch (err) {
    console.error('[api/companies/data] local subsidiary detail query failed:', err.message);
    return null;
  }
}

// Merges an already orderBy-sorted Rasayesh page with the (separately
// sorted) local subsidiary rows -- a plain concat would always trail
// subsidiaries at the end regardless of alphabetical position, since
// CompaniesClient.jsx fetches the full list (`all: true`) and paginates
// client-side. Null/missing field values sort last, matching the
// `ORDER BY ... NULLS LAST` the rest of this codebase already uses.
function compareByField(a, b, field) {
  const av = a?.[field];
  const bv = b?.[field];
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return String(av).localeCompare(String(bv));
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    const currentEventId = await getCurrentEventId();
    const cfg = await getCachedCompaniesConfig(currentEventId);
    const eventId = cfg.eventId != null ? Number(cfg.eventId) : null;

    if (type === 'list') {
      const search = searchParams.get('search') || '';
      const orderBy = searchParams.get('orderBy') || 'brand_name_fa';
      const result = await getCachedCompaniesList(search, orderBy, eventId, cfg.eventOrigin);
      const rasayeshCompanies = result?.data?.eventCompanies ?? [];

      const localSubsidiaries = await fetchLocalSubsidiaries(currentEventId, eventId, search);

      const merged = [...rasayeshCompanies, ...localSubsidiaries];
      merged.sort((a, b) => compareByField(a, b, orderBy));

      return NextResponse.json({ companies: merged });
    }

    if (type === 'sponsorship') {
      const result = await getCachedSponsorshipLevels(eventId, cfg.eventOrigin);
      return NextResponse.json({ levels: result?.data?.sponsorshipLevels ?? [] });
    }

    if (type === 'featured') {
      const result = await getCachedFeaturedCompanies(cfg.eventOrigin);
      return NextResponse.json({ featured: result?.data?.eventFeatureCompanies ?? [] });
    }

    if (type === 'detail') {
      const slug = searchParams.get('slug');
      if (!slug) return NextResponse.json({ error: 'missing slug' }, { status: 400 });
      const result = await getCachedCompanyDetail(slug, eventId, cfg.eventOrigin);
      // Only fall back on null -- never override a successful Rasayesh
      // result. The one subsidiary that's also independently registered
      // for this event (id 561) already resolves live and must keep using
      // that path, not the local one.
      const company = result?.data?.eventCompany ?? (await fetchLocalSubsidiaryDetail(currentEventId, eventId, slug));
      return NextResponse.json({ company });
    }

    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  } catch (err) {
    console.error('[api/companies/data]', err?.graphQLErrors ?? err?.message ?? err);
    return NextResponse.json({ error: 'Failed to fetch company data' }, { status: 500 });
  }
}
