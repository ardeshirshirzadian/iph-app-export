const GQL = 'https://api.rasayesh.com/graphql';

const EVENT_INFO_QUERY = `
  query GetRasayeshEventInfo($id: Int) {
    event(id: $id) {
      website
      slug
    }
  }
`;

const EVENT_INFO_TTL_MS = 5 * 60 * 1000;
const eventInfoCache = new Map(); // eventId -> { data, expiresAt }

// Resolves an event's canonical website/slug from Rasayesh directly, so
// outbound calls never depend on a hardcoded event domain that changes
// every year when the admin points registration_config at a new event.
export async function getRasayeshEventInfo(eventId) {
  const id = Number(eventId);
  const cached = eventInfoCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rasayesh-site': 'iph',
    },
    body: JSON.stringify({ query: EVENT_INFO_QUERY, variables: { id } }),
  });

  const json = await res.json();
  const event = json?.data?.event;
  if (!event?.website) {
    throw new Error(`Unable to resolve Rasayesh event info for event_id=${id}`);
  }

  const website = /^https?:\/\//.test(event.website) ? event.website : `https://${event.website}`;
  const data = { website, slug: event.slug };

  eventInfoCache.set(id, { data, expiresAt: Date.now() + EVENT_INFO_TTL_MS });
  return data;
}

export async function fetchPublicGraphQL(query, variables = {}, eventOrigin) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rasayesh-site': 'iph',
      origin: eventOrigin,
      referer: `${eventOrigin}/`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    const err = new Error(json.errors[0]?.message || 'GraphQL error');
    err.graphQLErrors = json.errors;
    throw err;
  }
  return json;
}

const EVENT_REGISTRATION_PLANS_QUERY = `
  query EventRegistrationPlans($eventId: Int, $orderBy: String, $order: String) {
    eventRegistrationPlans(eventId: $eventId, orderBy: $orderBy, order: $order, all: true) {
      id
      event_id
      title_fa
      title_en
      description_fa
      description_en
      features_fa
      features_en
      icon
      color
      price
      discount
      capacity
      usage_count
      disable_wizard
      is_retraining
      force_selection
      disabled
    }
  }
`;

const REGISTRATION_PLANS_TTL_MS = 5 * 60 * 1000;
const registrationPlansCache = new Map(); // eventId -> { data, expiresAt }

// Shared by RegisterClient.jsx and ConfirmClient.jsx — same wizard session,
// same event, so a fetch by either step can serve the other. Mirrors
// getRasayeshEventInfo()'s TTL-cache pattern above; this is public
// (unauthenticated) data fetched via fetchPublicGraphQL, not through Apollo.
export async function getEventRegistrationPlans(eventId, eventOrigin) {
  const id = Number(eventId);
  const cached = registrationPlansCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const result = await fetchPublicGraphQL(
    EVENT_REGISTRATION_PLANS_QUERY,
    { eventId: id, orderBy: 'order', order: 'ASC' },
    eventOrigin
  );
  const plans = result?.data?.eventRegistrationPlans ?? [];

  registrationPlansCache.set(id, { data: plans, expiresAt: Date.now() + REGISTRATION_PLANS_TTL_MS });
  return plans;
}
