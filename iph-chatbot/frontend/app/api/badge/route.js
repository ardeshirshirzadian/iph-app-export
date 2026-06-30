import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('iph_access_token')?.value;
  const userRaw = cookieStore.get('iph_user')?.value;

  if (!accessToken || !userRaw) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let uuid;
  try {
    uuid = JSON.parse(decodeURIComponent(userRaw))?.uuid;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!uuid) {
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
        query: `query GetBadge($uuid: String!) {
          attendeeEventCard(eventSlug: "iph", uuid: $uuid) {
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
        variables: { uuid },
      }),
    });

    const body = await res.json();

    if (body.errors?.length) {
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

    return Response.json(body.data?.attendeeEventCard ?? {});
  } catch {
    return Response.json({ error: 'خطا در ارتباط با سرور' }, { status: 502 });
  }
}
