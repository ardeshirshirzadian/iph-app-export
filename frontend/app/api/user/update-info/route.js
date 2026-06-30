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

  // Read existing user data from cookie for required-field fallbacks
  let existingUser = {};
  try {
    const raw = cookieStore.get('iph_user')?.value;
    if (raw) existingUser = JSON.parse(decodeURIComponent(raw));
  } catch { /* ignore */ }

  const firstnameFa  = sanitize(body.firstnameFa);
  const lastnameFa   = sanitize(body.lastnameFa);
  // firstnameEn/lastnameEn are required by rasayesh — fall back to existing cookie value
  const firstnameEn  = sanitize(body.firstnameEn) || sanitize(existingUser.firstname_en);
  const lastnameEn   = sanitize(body.lastnameEn)  || sanitize(existingUser.lastname_en);
  const jobTitleFa   = sanitize(body.jobTitleFa);
  const jobTitleEn   = sanitize(body.jobTitleEn);
  const nationalCode = sanitize(body.nationalCode);

  const rasayeshConfig = await getEventConfig();

  try {
    const { data, error, unauthorized } = await rasayeshQuery({
      query: `mutation {
        attendeeUpdateProfileInfo(
          firstnameFa: "${firstnameFa}"
          lastnameFa: "${lastnameFa}"
          firstnameEn: "${firstnameEn}"
          lastnameEn: "${lastnameEn}"
          jobTitleFa: "${jobTitleFa}"
          jobTitleEn: "${jobTitleEn}"
          nationalCode: "${nationalCode}"
        )
      }`,
      token,
      config: rasayeshConfig,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error }, { status: 502 });

    const result = data?.attendeeUpdateProfileInfo;
    const isSuccess = result?.status === 'success' || result?.success === true;

    if (!isSuccess) {
      return NextResponse.json(
        { error: result?.message || 'خطا در بروزرسانی اطلاعات' },
        { status: 400 }
      );
    }

    // Merge updated fields into iph_user cookie
    const updatedPayload = {
      ...existingUser,
      ...(firstnameFa && { firstname_fa: firstnameFa }),
      ...(lastnameFa  && { lastname_fa: lastnameFa }),
      ...(firstnameEn && { firstname_en: firstnameEn }),
      ...(lastnameEn  && { lastname_en: lastnameEn }),
      ...(jobTitleFa  && { job_title_fa: jobTitleFa }),
    };
    const response = NextResponse.json({ success: true });
    response.cookies.set('iph_user', JSON.stringify(updatedPayload), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'خطا در ارتباط با سرور' }, { status: 502 });
  }
}
