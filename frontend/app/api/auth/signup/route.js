import { NextResponse } from 'next/server';
import { rasayeshQuery, getEventConfig } from '@/lib/rasayeshClient';

function sanitize(v) {
  return String(v ?? '').replace(/"/g, '').trim();
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const rasayeshConfig = await getEventConfig();

  const firstnameFa  = sanitize(body.firstnameFa);
  const lastnameFa   = sanitize(body.lastnameFa);
  const firstnameEn  = sanitize(body.firstnameEn);
  const lastnameEn   = sanitize(body.lastnameEn);
  const jobTitleFa   = sanitize(body.jobTitleFa);
  const jobTitleEn   = sanitize(body.jobTitleEn);
  const nationalCode = sanitize(body.nationalCode);
  const mobile       = sanitize(body.mobile);
  const email        = sanitize(body.email);
  const occupationId   = parseInt(body.occupationId) || 0;
  const educationLevelId = parseInt(body.educationLevelId) || 0;
  const fieldOfActivities = Array.isArray(body.fieldOfActivities)
    ? body.fieldOfActivities.map(Number).filter(Boolean)
    : [];
  const fieldOfActivitiesStr = fieldOfActivities.length ? `[${fieldOfActivities.join(', ')}]` : '[]';

  try {
    const { data, error, unauthorized } = await rasayeshQuery({
      query: `mutation {
        attendeeRegister(
          firstnameFa: "${firstnameFa}"
          lastnameFa: "${lastnameFa}"
          firstnameEn: "${firstnameEn}"
          lastnameEn: "${lastnameEn}"
          ${mobile ? `mobile: "${mobile}"` : ''}
          ${email ? `email: "${email}"` : ''}
          nationalCode: "${nationalCode}"
          jobTitleFa: "${jobTitleFa}"
          jobTitleEn: "${jobTitleEn}"
          ${occupationId ? `occupationId: ${occupationId}` : ''}
          fieldOfActivities: ${fieldOfActivitiesStr}
          ${educationLevelId ? `educationLevelId: ${educationLevelId}` : ''}
        )
      }`,
      config: rasayeshConfig,
    });

    if (unauthorized) return NextResponse.json({ error: 'خطا در ایجاد حساب' }, { status: 400 });
    if (error) return NextResponse.json({ error }, { status: 400 });

    const result = data?.attendeeRegister;
    const failed = result?.status === 'error' || result?.success === false || result?.error;
    if (failed) {
      return NextResponse.json(
        { error: result?.message || result?.error || 'خطا در ایجاد حساب' },
        { status: 400 }
      );
    }

    if (result?.access_token) {
      return NextResponse.json({ success: true, hasToken: true });
    }

    // Trigger OTP for auto-login
    const contact = mobile || email;
    if (contact) {
      await rasayeshQuery({
        query: `mutation { attendeeLogin(login: "${contact}") }`,
        config: rasayeshConfig,
      }).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Signup error:', err);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
