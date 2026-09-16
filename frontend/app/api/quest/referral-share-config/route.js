import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getRasayeshEventInfo } from '@/lib/publicRasayeshClient';
import { isUnlimitedReferralActive } from '@/lib/referralUnlimited';

const RASAYESH_URL = 'https://api.rasayesh.com/graphql';
const SITE_TEMPLATE_KEY = 'attendance_poster';

// Same split as every other config route in this feature: admin-authored
// content is cached (rarely changes), the "is this even on" gate is
// checked live on every call.
const getCachedReferralShareConfig = unstable_cache(
  async (currentEventId) => {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'referral_share_template_config'",
      [currentEventId]
    );
    return result.rows[0]?.value ?? null;
  },
  ['referral-share-config'],
  { tags: ['referral-share-config'], revalidate: 300 }
);

// eventTemplate is confirmed public (no bearer token needed, unlike
// attendeeEventCard) -- verified live via introspection + direct calls
// during this feature's own investigation. Still resolves eventOrigin via
// getRasayeshEventInfo and sends the standard origin/referer headers for
// consistency with every other outbound Rasayesh call in this codebase,
// even though a minimal test call without them also worked.
async function fetchSiteTemplate(currentEventId) {
  const regResult = await query(
    "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'registration_config'",
    [currentEventId]
  );
  const regConfig = regResult.rows[0]?.value ?? {};
  const rasayeshEventId = regConfig.event_id ? Number(regConfig.event_id) : null;
  if (!rasayeshEventId) return null;

  const eventInfo = await getRasayeshEventInfo(rasayeshEventId);
  const res = await fetch(RASAYESH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rasayesh-site': 'event',
      origin: eventInfo.website,
      referer: `${eventInfo.website}/`,
      lang: 'fa',
    },
    body: JSON.stringify({
      query: `query($eventId: Int, $key: String){ eventTemplate(eventId: $eventId, key: $key) { value } }`,
      variables: { eventId: rasayeshEventId, key: SITE_TEMPLATE_KEY },
    }),
    signal: AbortSignal.timeout(10000),
  }).then((r) => r.json());

  const value = res?.data?.eventTemplate?.value;
  if (!value || !Array.isArray(value.elements) || value.elements.length === 0) return null;
  return value;
}

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();

    // Same gate as Parts 1/2 -- the whole feature is scoped to the same
    // unlimited-mode mission being active, not to any referral_code
    // mission existing at all.
    const active = await isUnlimitedReferralActive(currentEventId);
    if (!active) {
      return NextResponse.json({ active: false, mode: null });
    }

    const config = await getCachedReferralShareConfig(currentEventId);

    // Strictly either/or, matching exactly what the admin configured -- no
    // silent substitution from one mode to the other. If the toggle is on
    // but Rasayesh's template turns out to be unusable, hide the share
    // entry point entirely (same inert-when-unconfigured principle as every
    // other gate in this feature), never fall back to the custom template.
    if (config?.use_site_template) {
      let siteTemplate = null;
      try {
        siteTemplate = await fetchSiteTemplate(currentEventId);
      } catch (e) {
        console.error('[quest/referral-share-config] site template fetch failed:', e.message);
      }
      if (siteTemplate) {
        return NextResponse.json({
          active: true,
          mode: 'site',
          siteTemplate,
          overlay: config.overlay || null,
        });
      }
      return NextResponse.json({ active: false, mode: null });
    }

    const hasCustomTemplate = !!config && Array.isArray(config.elements) && config.elements.length > 0;
    if (hasCustomTemplate) {
      return NextResponse.json({ active: true, mode: 'custom', template: { editor: config.editor, elements: config.elements } });
    }

    return NextResponse.json({ active: false, mode: null });
  } catch (e) {
    console.error('[quest/referral-share-config GET]', e.message);
    return NextResponse.json({ active: false, mode: null });
  }
}
