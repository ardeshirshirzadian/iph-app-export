import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';

const RASAYESH_URL = 'https://api.rasayesh.com/graphql';
const REFRESH_URL = 'https://api.rasayesh.com/refresh-token';
const ATTENDEE_ORIGIN = 'https://attendee.rasayesh.com';

let refreshPromise = null;

async function doRefresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) throw new Error('no_refresh_token');
    const res = await fetch(REFRESH_URL, {
      headers: { Authorization: `Bearer ${refreshToken}` },
    });
    const json = await res.json();
    if (json.status !== 'success' || !json.accessToken) throw new Error('refresh_failed');
    localStorage.setItem('access_token', json.accessToken);
    localStorage.setItem('refresh_token', json.refreshToken);
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function signOut() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  document.cookie = 'iph_user=; path=/; max-age=0';
  window.dispatchEvent(new CustomEvent('session-expired', {
    detail: { redirectTo: window.location.pathname },
  }));
}

function isUnauthorizedResponse(data) {
  return data?.errors?.some(
    e => e.message === 'Unauthorized' || e.extensions?.code === 'UNAUTHENTICATED'
  );
}

function createRasayeshFetch() {
  return async function rasayeshFetch(uri, options) {
    const token = localStorage.getItem('access_token');
    const authedOpts = {
      ...options,
      headers: {
        ...options.headers,
        'x-rasayesh-site': 'attendee',
        'origin': ATTENDEE_ORIGIN,
        'referer': `${ATTENDEE_ORIGIN}/`,
        'lang': 'fa',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    };

    const response = await fetch(uri, authedOpts);

    let data;
    try {
      data = await response.clone().json();
    } catch {
      return response;
    }

    if (!isUnauthorizedResponse(data)) return response;

    // Refresh and retry once
    try {
      await doRefresh();
      const newToken = localStorage.getItem('access_token');
      return fetch(uri, {
        ...options,
        headers: {
          ...options.headers,
          'x-rasayesh-site': 'attendee',
          'origin': ATTENDEE_ORIGIN,
          'referer': `${ATTENDEE_ORIGIN}/`,
          'lang': 'fa',
          authorization: `Bearer ${newToken}`,
        },
      });
    } catch {
      signOut();
      return response;
    }
  };
}

let apolloClientInstance = null;

function createApolloClient() {
  return new ApolloClient({
    link: new HttpLink({
      uri: RASAYESH_URL,
      fetch: createRasayeshFetch(),
    }),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { fetchPolicy: 'no-cache', errorPolicy: 'all' },
      mutate: { errorPolicy: 'all' },
      watchQuery: { fetchPolicy: 'no-cache', errorPolicy: 'all' },
    },
  });
}

export function getApolloClient() {
  if (typeof window === 'undefined') return null;
  if (!apolloClientInstance) apolloClientInstance = createApolloClient();
  return apolloClientInstance;
}
