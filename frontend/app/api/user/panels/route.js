import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse, getEventConfig } from '@/lib/rasayeshClient';

const IRANPHARMA_EVENT_IDS = [1, 6, 14, 18, 26];
const CACHE_TTL_MS = 3_600_000; // 1 hour

let panelIdCache = null;
let panelIdCacheTime = 0;

async function getValidIranPharmaPanelIds() {
  const now = Date.now();
  if (panelIdCache && (now - panelIdCacheTime) < CACHE_TTL_MS) {
    return panelIdCache;
  }

  const allIds = new Set();

  for (const eventId of IRANPHARMA_EVENT_IDS) {
    try {
      const res = await fetch('https://api.rasayesh.com/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rasayesh-site': 'iph' },
        body: JSON.stringify({ query: `{ eventPanels(eventId: ${eventId}) { id } }` }),
      });
      const json = await res.json();
      (json.data?.eventPanels ?? []).forEach(p => allIds.add(p.id));
    } catch {
      // skip failed event; use whatever IDs were collected so far
    }
  }

  panelIdCache = allIds;
  panelIdCacheTime = now;
  return allIds;
}

export async function GET() {
  const cookieStore = await cookies();
  const token = getTokenFromCookies(cookieStore);

  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [config, validIds] = await Promise.all([
      getEventConfig(),
      getValidIranPharmaPanelIds(),
    ]);

    const { data, error, unauthorized } = await rasayeshQuery({
      query: `{ attendeePanels { id panel { id title_fa title_en starts_at ends_at hall_fa hall_en event { id title_fa title_en } } } }`,
      token,
      config,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error: 'GraphQL error' }, { status: 502 });

    const panels = (data?.attendeePanels ?? [])
      .filter(item => validIds.has(item.panel?.id))
      .map(item => ({
        ...item.panel,
        isOnline: false,
        event_name: item.panel?.event?.title_fa ?? null,
      }))
      .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));

    return NextResponse.json({ panels, count: panels.length });
  } catch (err) {
    console.error('[user/panels]', err.message);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
