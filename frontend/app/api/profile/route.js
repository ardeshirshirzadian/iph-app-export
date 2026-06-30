import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse } from '@/lib/rasayeshClient';

export async function GET() {
  const cookieStore = await cookies();
  const token = getTokenFromCookies(cookieStore);
  const userRaw = cookieStore.get('iph_user')?.value;

  if (!token || !userRaw) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let attendeeId;
  try {
    attendeeId = JSON.parse(decodeURIComponent(userRaw))?.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!attendeeId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data, error, unauthorized } = await rasayeshQuery({
      query: `query GetAttendee($id: Int!) {
        attendee(id: $id) {
          firstname_en
          lastname_en
          national_code
          email
          profile
          todayEventPresence(eventId: 1)
          eventPanels(eventId: 1) { title_fa starts_at ends_at hall_fa }
          eventOnlineWorkshops(eventId: 1) { title_fa starts_at ends_at }
          eventTransactions(eventId: 1) { status total_price price_paid created_at }
        }
      }`,
      variables: { id: Number(attendeeId) },
      token,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) {
      console.error('GraphQL error:', error);
      return NextResponse.json({ error: 'GraphQL error' }, { status: 502 });
    }

    return NextResponse.json({ attendee: data?.attendee });
  } catch {
    return NextResponse.json({ error: 'خطا در ارتباط با سرور' }, { status: 502 });
  }
}
