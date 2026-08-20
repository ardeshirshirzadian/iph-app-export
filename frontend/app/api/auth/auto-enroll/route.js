import { query } from '@/lib/db';
import { getRasayeshEventInfo } from '@/lib/publicRasayeshClient';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getEventDomain } from '@/lib/domainEventMap';

const RASAYESH_URL = 'https://api.rasayesh.com/graphql';

function rasayeshFetch(gqlQuery, variables, accessToken, eventOrigin) {
  return fetch(RASAYESH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rasayesh-site': 'event',
      'origin': eventOrigin,
      'referer': `${eventOrigin}/`,
      'lang': 'fa',
      'authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query: gqlQuery, variables }),
  }).then((r) => r.json());
}

const CHECK_REGISTERED_QUERY = `
  query AutoEnrollCheck($uuid: String!, $eventSlug: String!) {
    attendeeEventCard(eventSlug: $eventSlug, uuid: $uuid) {
      data {
        registrationPlan { id }
      }
    }
  }
`;

const ADD_WIZARD_ITEMS_MUTATION = `
  mutation AutoEnrollAdd($items: JSONObject!, $redirectUrl: String!) {
    addWizardItemsToCart(items: $items, redirectUrl: $redirectUrl)
  }
`;

export async function POST(request) {
  try {
    let accessToken, uuid;
    try {
      ({ accessToken, uuid } = await request.json());
    } catch {
      return Response.json({ action: 'failed', reason: 'invalid_body' }, { status: 400 });
    }

    if (!accessToken || !uuid) {
      return Response.json({ action: 'failed', reason: 'missing_fields' }, { status: 400 });
    }

    const currentEventId = await getCurrentEventId();
    const regResult = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'registration_config'",
      [currentEventId]
    );
    const regConfig = regResult.rows[0]?.value ?? {};

    const autoEnrollEnabled = !!regConfig.auto_enroll_enabled;
    const planId = regConfig.auto_enroll_plan_id ? Number(regConfig.auto_enroll_plan_id) : null;
    const eventId = regConfig.event_id ? Number(regConfig.event_id) : null;

    if (!autoEnrollEnabled || !planId || !eventId) {
      return Response.json({ action: 'disabled' });
    }

    let eventOrigin, eventSlug;
    try {
      const eventInfo = await getRasayeshEventInfo(eventId);
      eventOrigin = eventInfo.website;
      eventSlug = eventInfo.slug;
    } catch (err) {
      console.error('[auto-enroll] event lookup failed:', err.message);
      return Response.json({ action: 'failed', reason: 'event_lookup_error' });
    }

    // Check if user already has any registration plan for this event
    const checkResult = await rasayeshFetch(
      CHECK_REGISTERED_QUERY,
      { uuid, eventSlug },
      accessToken,
      eventOrigin
    );

    const existingPlan = checkResult?.data?.attendeeEventCard?.data?.registrationPlan?.id;
    if (existingPlan) {
      return Response.json({ action: 'skipped', reason: 'already_enrolled' });
    }

    // User has no plan — auto-enroll in the configured free plan. redirectUrl
    // must point back at the LOCAL event's own domain (currentEventId, the
    // resolved local events.id) -- not the Rasayesh event id used above for
    // eventOrigin/eventSlug, which is a different id from a different system.
    const localDomain = await getEventDomain(currentEventId);
    const enrollResult = await rasayeshFetch(
      ADD_WIZARD_ITEMS_MUTATION,
      {
        items: {
          EventRegistrationPlan: [planId],
          EventPanel: [],
          EventLunch: [],
          EventService: [],
          EventMeal: [],
        },
        redirectUrl: `https://${localDomain}/cart/callback`,
      },
      accessToken,
      eventOrigin
    );

    if (enrollResult?.errors?.length) {
      const msg = enrollResult.errors[0]?.message || 'mutation_error';
      console.error('[auto-enroll] addWizardItemsToCart GraphQL error:', msg);
      return Response.json({ action: 'failed', reason: msg });
    }

    const raw = enrollResult?.data?.addWizardItemsToCart;
    const result = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (result?.status !== 'success') {
      const reason = result?.error || result?.message || 'unknown_error';
      console.error(
        '[auto-enroll] addWizardItemsToCart failed uuid=%s planId=%d reason=%s',
        uuid,
        planId,
        reason
      );
      return Response.json({ action: 'failed', reason });
    }

    console.log('[auto-enroll] enrolled uuid=%s planId=%d', uuid, planId);
    return Response.json({ action: 'enrolled' });
  } catch (err) {
    console.error('[auto-enroll] unexpected error:', err.message);
    return Response.json({ action: 'failed', reason: 'server_error' });
  }
}
