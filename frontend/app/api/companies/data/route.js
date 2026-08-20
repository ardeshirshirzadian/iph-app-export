import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getCachedCompaniesConfig } from '@/lib/getCompaniesConfig';
import { fetchPublicGraphQL } from '@/lib/publicRasayeshClient';
import { getCurrentEventId } from '@/lib/currentEvent';

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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    const cfg = await getCachedCompaniesConfig(await getCurrentEventId());
    const eventId = cfg.eventId != null ? Number(cfg.eventId) : null;

    if (type === 'list') {
      const search = searchParams.get('search') || '';
      const orderBy = searchParams.get('orderBy') || 'brand_name_fa';
      const result = await getCachedCompaniesList(search, orderBy, eventId, cfg.eventOrigin);
      return NextResponse.json({ companies: result?.data?.eventCompanies ?? [] });
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
      return NextResponse.json({ company: result?.data?.eventCompany ?? null });
    }

    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  } catch (err) {
    console.error('[api/companies/data]', err?.graphQLErrors ?? err?.message ?? err);
    return NextResponse.json({ error: 'Failed to fetch company data' }, { status: 500 });
  }
}
