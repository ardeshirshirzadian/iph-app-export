import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse, getEventConfig } from '@/lib/rasayeshClient';

function sanitize(v) {
  return String(v ?? '').replace(/"/g, '').trim();
}

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

  const email = sanitize(body.email);
  const phone = sanitize(body.phone);
  const rasayeshConfig = await getEventConfig();

  try {
    const { data, error, unauthorized } = await rasayeshQuery({
      query: `mutation {
        attendeeUpdateProfileContact(
          email: "${email}"
          phone: "${phone}"
        )
      }`,
      token,
      config: rasayeshConfig,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error }, { status: 502 });

    const result = data?.attendeeUpdateProfileContact;
    const isSuccess = result?.status === 'success' || result?.success === true;

    if (!isSuccess) {
      return NextResponse.json(
        { error: result?.message || 'خطا در بروزرسانی اطلاعات تماس' },
        { status: 400 }
      );
    }

    // Update email in iph_user cookie
    let existingUser = {};
    try {
      const raw = cookieStore.get('iph_user')?.value;
      if (raw) existingUser = JSON.parse(decodeURIComponent(raw));
    } catch { /* ignore */ }

    if (email || existingUser) {
      const updatedPayload = { ...existingUser, ...(email && { email }) };
      const response = NextResponse.json({ success: true });
      response.cookies.set('iph_user', JSON.stringify(updatedPayload), {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
      return response;
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'خطا در ارتباط با سرور' }, { status: 502 });
  }
}
