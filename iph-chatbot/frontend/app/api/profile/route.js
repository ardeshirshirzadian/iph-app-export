import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('iph_access_token')?.value;
  const userRaw = cookieStore.get('iph_user')?.value;

  if (!accessToken || !userRaw) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let attendeeId;
  try {
    attendeeId = JSON.parse(decodeURIComponent(userRaw))?.id;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!attendeeId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch('https://api.rasayesh.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
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
      }),
    });

    const body = await res.json();

    if (body.errors?.length) {
      console.error('GraphQL errors:', JSON.stringify(body.errors));
      const isUnauth = body.errors.some(
        (e) =>
          e.message?.toLowerCase().includes('unauthorized') ||
          e.extensions?.code === 'UNAUTHENTICATED'
      );
      return Response.json(
        { error: isUnauth ? 'Unauthorized' : 'GraphQL error' },
        { status: isUnauth ? 401 : 502 }
      );
    }

    return Response.json({ attendee: body.data?.attendee });
  } catch {
    return Response.json({ error: 'خطا در ارتباط با سرور' }, { status: 502 });
  }
}
