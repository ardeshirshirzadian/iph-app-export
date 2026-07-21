import { query } from '@/lib/db';

const RASAYESH_URL = 'https://api.rasayesh.com/graphql';
const ATTENDEE_ORIGIN = 'https://attendee.rasayesh.com';

function rasayeshFetch(gqlQuery, variables, accessToken) {
  return fetch(RASAYESH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rasayesh-site': 'attendee',
      'origin': ATTENDEE_ORIGIN,
      'referer': `${ATTENDEE_ORIGIN}/`,
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
  mutation AutoEnrollAdd($planIds: [Int!]!, $redirectUrl: String!) {
    addWizardItemsToCart(items: { plan_ids: $planIds }, redirectUrl: $redirectUrl)
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

    // Read registration config and badge page settings concurrently
    const [regResult, badgeResult] = await Promise.all([
      query("SELECT value FROM app_settings WHERE key = 'registration_config'"),
      query("SELECT value FROM app_settings WHERE key = 'badge_page'"),
    ]);

    const regConfig = regResult.rows[0]?.value ?? {};
    const badgeConfig = badgeResult.rows[0]?.value ?? {};

    const autoEnrollEnabled = !!regConfig.auto_enroll_enabled;
    const planId = regConfig.auto_enroll_plan_id ? Number(regConfig.auto_enroll_plan_id) : null;

    if (!autoEnrollEnabled || !planId) {
      return Response.json({ action: 'disabled' });
    }

    const eventSlug = badgeConfig.event_slug || 'iph';

    // Check if user already has any registration plan for this event
    const checkResult = await rasayeshFetch(
      CHECK_REGISTERED_QUERY,
      { uuid, eventSlug },
      accessToken
    );

    const existingPlan = checkResult?.data?.attendeeEventCard?.data?.registrationPlan?.id;
    if (existingPlan) {
      return Response.json({ action: 'skipped', reason: 'already_enrolled' });
    }

    // User has no plan — auto-enroll in the configured free plan
    const enrollResult = await rasayeshFetch(
      ADD_WIZARD_ITEMS_MUTATION,
      { planIds: [planId], redirectUrl: 'https://app.iphexpo.com/cart/callback' },
      accessToken
    );

    if (enrollResult?.errors?.length) {
      const msg = enrollResult.errors[0]?.message || 'mutation_error';
      console.error('[auto-enroll] addWizardItemsToCart error:', msg);
      return Response.json({ action: 'failed', reason: msg });
    }

    console.log('[auto-enroll] enrolled uuid=%s planId=%d', uuid, planId);
    return Response.json({ action: 'enrolled' });
  } catch (err) {
    console.error('[auto-enroll] unexpected error:', err.message);
    return Response.json({ action: 'failed', reason: 'server_error' });
  }
}
