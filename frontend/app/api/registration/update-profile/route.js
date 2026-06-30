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

  // Read existing user for required-field fallbacks
  let existingUser = {};
  try {
    const raw = cookieStore.get('iph_user')?.value;
    if (raw) existingUser = JSON.parse(decodeURIComponent(raw));
  } catch { /* ignore */ }

  const rasayeshConfig = await getEventConfig();

  const firstnameFa    = sanitize(body.firstnameFa);
  const lastnameFa     = sanitize(body.lastnameFa);
  const firstnameEn    = sanitize(body.firstnameEn) || sanitize(existingUser.firstname_en);
  const lastnameEn     = sanitize(body.lastnameEn)  || sanitize(existingUser.lastname_en);
  const jobTitleFa     = sanitize(body.jobTitleFa);
  const jobTitleEn     = sanitize(body.jobTitleEn);
  const nationalCode   = sanitize(body.nationalCode);
  const email          = sanitize(body.email);
  const phone          = sanitize(body.phone);
  const occupationId   = parseInt(body.occupationId) || 0;
  const educationLevelId = parseInt(body.educationLevelId) || 0;
  const fieldOfActivities = Array.isArray(body.fieldOfActivities)
    ? body.fieldOfActivities.map(Number).filter(Boolean)
    : [];
  const fieldOfActivitiesStr = fieldOfActivities.length ? `[${fieldOfActivities.join(', ')}]` : '[]';

  try {
    // 1. Update personal info
    const infoResult = await rasayeshQuery({
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

    if (infoResult.unauthorized) return sessionExpiredResponse();
    if (infoResult.error) return NextResponse.json({ error: infoResult.error }, { status: 400 });

    // 2. Update contact (non-fatal)
    if (email || phone) {
      const contactResult = await rasayeshQuery({
        query: `mutation {
          attendeeUpdateProfileContact(
            email: "${email}"
            phone: "${phone}"
          )
        }`,
        token,
        config: rasayeshConfig,
      });
      if (contactResult.unauthorized) return sessionExpiredResponse();
    }

    // 3. Update activity (non-fatal if no fields given)
    if (occupationId || fieldOfActivities.length || educationLevelId) {
      const activityResult = await rasayeshQuery({
        query: `mutation {
          attendeeUpdateProfileActivity(
            industryId: 1
            ${occupationId ? `occupationId: ${occupationId}` : ''}
            fieldOfActivities: ${fieldOfActivitiesStr}
            ${educationLevelId ? `educationLevelId: ${educationLevelId}` : ''}
          )
        }`,
        token,
        config: rasayeshConfig,
      });
      if (activityResult.unauthorized) return sessionExpiredResponse();
    }

    // Update iph_user cookie
    const updatedPayload = {
      ...existingUser,
      ...(firstnameFa && { firstname_fa: firstnameFa }),
      ...(lastnameFa  && { lastname_fa: lastnameFa }),
      ...(firstnameEn && { firstname_en: firstnameEn }),
      ...(lastnameEn  && { lastname_en: lastnameEn }),
      ...(jobTitleFa  && { job_title_fa: jobTitleFa }),
      ...(email       && { email }),
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
  } catch (err) {
    console.error('update-profile error:', err);
    return NextResponse.json({ error: 'خطا در بروزرسانی اطلاعات' }, { status: 500 });
  }
}
