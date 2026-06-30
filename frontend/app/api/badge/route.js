import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse } from '@/lib/rasayeshClient';
import { query } from '@/lib/db';

export async function GET() {
  const cookieStore = await cookies();
  const token = getTokenFromCookies(cookieStore);
  const userRaw = cookieStore.get('iph_user')?.value;

  if (!token || !userRaw) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let uuid;
  try {
    uuid = JSON.parse(decodeURIComponent(userRaw))?.uuid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!uuid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Read badge_event_id and event_slug from badge_page settings
  let eventSlug = 'iph';
  let badgeEventId = 18; // fallback: IranPharma 2025
  try {
    const settingsRes = await query("SELECT value FROM app_settings WHERE key = 'badge_page'");
    const s = settingsRes.rows[0]?.value ?? {};
    badgeEventId = Number(s.badge_event_id) || 18;
    eventSlug = s.event_slug || 'iph';
  } catch {
    // Fail-open: use defaults
  }

  try {
    const { data, error, unauthorized } = await rasayeshQuery({
      query: `query GetBadge($uuid: String!, $eventSlug: String!) {
        attendeeEventCard(eventSlug: $eventSlug, uuid: $uuid) {
          status
          message
          data {
            attendee {
              firstname_fa
              lastname_fa
              firstname_en
              lastname_en
              uuid
              job_title_fa
              mobile
            }
            registrationPlan {
              id
            }
            event {
              id
              slug
            }
          }
        }
      }`,
      variables: { uuid, eventSlug },
      token,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error: 'GraphQL error' }, { status: 502 });

    return NextResponse.json({ ...(data?.attendeeEventCard ?? {}), badge_event_id: badgeEventId });
  } catch {
    return NextResponse.json({ error: 'خطا در ارتباط با سرور' }, { status: 502 });
  }
}
