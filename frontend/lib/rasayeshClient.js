import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function rasayeshQuery({ query: gqlQuery, variables, token, config }) {
  const origin = config?.event_origin || 'https://2025.iphexpo.com';
  const site = config?.rasayesh_site || 'event';

  const headers = {
    'content-type': 'application/json',
    'x-rasayesh-site': site,
    'origin': origin,
    'referer': `${origin}/`,
  };

  if (token) headers['authorization'] = `Bearer ${token}`;

  const res = await fetch('https://api.rasayesh.com/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: gqlQuery, variables }),
    cache: 'no-store',
  });

  const data = await res.json();

  if (data.errors?.some(
    (e) =>
      e.message === 'Unauthorized' ||
      e.message?.toLowerCase() === 'unauthorized' ||
      e.extensions?.code === 'UNAUTHENTICATED'
  )) {
    return { unauthorized: true };
  }

  if (data.errors?.length) {
    return { error: data.errors[0].message };
  }

  return { data: data.data };
}

export async function getEventConfig() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'cart_config'");
    const config = result.rows[0]?.value ?? {};
    return {
      rasayesh_site: 'event',
      event_origin: config.event_origin || 'https://2025.iphexpo.com',
    };
  } catch {
    return { rasayesh_site: 'event', event_origin: 'https://2025.iphexpo.com' };
  }
}

export function getTokenFromCookies(cookieStore) {
  return cookieStore.get('iph_access_token')?.value ?? null;
}

export function sessionExpiredResponse() {
  const response = NextResponse.json(
    { error: 'session_expired', message: 'جلسه شما منقضی شده است' },
    { status: 401 }
  );
  response.cookies.set('iph_access_token', '', { path: '/', maxAge: 0 });
  response.cookies.set('iph_refresh_token', '', { path: '/', maxAge: 0 });
  response.cookies.set('iph_user', '', { path: '/', maxAge: 0 });
  return response;
}
