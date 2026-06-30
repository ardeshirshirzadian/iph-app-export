import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse, getEventConfig } from '@/lib/rasayeshClient';

export async function POST(request) {
  const cookieStore = await cookies();
  const token = getTokenFromCookies(cookieStore);
  if (!token) return sessionExpiredResponse();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const occupationId     = parseInt(body.occupationId) || 0;
  const educationLevelId = parseInt(body.educationLevelId) || 0;
  const fieldOfActivities = Array.isArray(body.fieldOfActivities)
    ? body.fieldOfActivities.map(Number).filter(Boolean)
    : [];
  const fieldStr = `[${fieldOfActivities.join(', ')}]`;
  const rasayeshConfig = await getEventConfig();

  try {
    const { data, error, unauthorized } = await rasayeshQuery({
      query: `mutation {
        attendeeUpdateProfileActivity(
          industryId: 1
          ${occupationId ? `occupationId: ${occupationId}` : ''}
          fieldOfActivities: ${fieldStr}
          ${educationLevelId ? `educationLevelId: ${educationLevelId}` : ''}
        )
      }`,
      token,
      config: rasayeshConfig,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'خطا در ارتباط با سرور' }, { status: 502 });
  }
}
