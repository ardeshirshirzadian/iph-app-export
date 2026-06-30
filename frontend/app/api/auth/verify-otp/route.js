import { cookies } from 'next/headers';
import { query } from '@/lib/db';

// In-memory OTP attempt tracking: mobile -> attemptCount
const otpAttempts = new Map();
const MAX_ATTEMPTS = 5;

function getAttempts(mobile) {
  return otpAttempts.get(mobile) || 0;
}

function incrementAttempts(mobile) {
  otpAttempts.set(mobile, getAttempts(mobile) + 1);
}

function resetAttempts(mobile) {
  otpAttempts.delete(mobile);
}

function normalizeMobile(raw) {
  const digits = String(raw ?? '')
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/\D/g, '');
  if (digits.startsWith('09')) return digits;
  if (digits.startsWith('9') && digits.length === 10) return '0' + digits;
  return digits;
}

export async function POST(request) {
  let mobile, code;
  try {
    ({ mobile, code } = await request.json());
  } catch {
    return Response.json({ success: false, message: 'درخواست نامعتبر' }, { status: 400 });
  }

  mobile = normalizeMobile(mobile);

  if (!mobile || !code) {
    return Response.json({ success: false, message: 'اطلاعات ناقص است' }, { status: 400 });
  }

  if (getAttempts(mobile) >= MAX_ATTEMPTS) {
    return Response.json(
      { success: false, message: 'تعداد تلاش‌های مجاز تمام شد. لطفاً کد جدید درخواست کنید.' },
      { status: 429 }
    );
  }

  try {
    const res = await fetch('https://api.rasayesh.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `mutation AttendeeLoginValidateOTP($mobile: String!, $code: String!) {
          attendeeLoginValidateOTP(mobile: $mobile, code: $code)
        }`,
        variables: { mobile, code },
      }),
    });

    const { data, errors } = await res.json();

    if (errors?.length) {
      incrementAttempts(mobile);
      return Response.json({ success: false, message: 'خطا در تأیید کد' }, { status: 502 });
    }

    const result = typeof data?.attendeeLoginValidateOTP === 'string'
      ? JSON.parse(data.attendeeLoginValidateOTP)
      : data?.attendeeLoginValidateOTP;

    if (result?.status !== 'success') {
      incrementAttempts(mobile);
      return Response.json({
        success: false,
        message: result?.message || 'کد وارد شده اشتباه است',
      });
    }

    const u = result.user || {};

    let tokenVersion = 1;
    try {
      const tvResult = await query(
        "SELECT value FROM app_settings WHERE key = 'auth_token_version'",
        []
      );
      tokenVersion = tvResult.rows[0]?.value?.version ?? 1;
    } catch {
      // Non-fatal: if DB read fails, default to 1 so login still succeeds
    }

    const userPayload = {
      id: u.id,
      uuid: u.uuid,
      firstname_fa: u.firstname_fa,
      lastname_fa: u.lastname_fa,
      firstname_en: u.firstname_en,
      lastname_en: u.lastname_en,
      mobile: u.mobile,
      job_title_fa: u.job_title_fa,
      email: u.email,
      tokenVersion,
    };

    const cookieStore = await cookies();
    const sharedOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    };

    cookieStore.set('iph_access_token', result.accessToken, { ...sharedOpts, maxAge: 60 * 60 });
    cookieStore.set('iph_refresh_token', result.refreshToken, { ...sharedOpts, maxAge: 60 * 60 * 24 * 90 });
    cookieStore.set('iph_user', JSON.stringify(userPayload), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    resetAttempts(mobile);

    // Fire-and-forget: upsert into app_users — never block login on this
    upsertAppUser(u).catch((err) =>
      console.error('[app_users upsert error]', err)
    );

    return Response.json({
      success: true,
      firstname_fa: userPayload.firstname_fa,
      lastname_fa: userPayload.lastname_fa,
    });
  } catch {
    return Response.json({ success: false, message: 'خطا در ارتباط با سرور' }, { status: 502 });
  }
}

async function upsertAppUser(u) {
  await query(
    `INSERT INTO app_users (
      rasayesh_id, uuid, firstname_fa, lastname_fa, firstname_en, lastname_en,
      mobile, email, national_code, job_title_fa, job_title_en, phone,
      industry_id, occupation_id, country_id, state_id,
      address_fa, address_en, postal_code, is_foreign,
      mobile_verified, email_verified, profile_image, raw_data,
      first_login_at, last_login_at, login_count
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
      NOW(), NOW(), 1
    )
    ON CONFLICT (uuid) DO UPDATE SET
      rasayesh_id     = EXCLUDED.rasayesh_id,
      firstname_fa    = EXCLUDED.firstname_fa,
      lastname_fa     = EXCLUDED.lastname_fa,
      firstname_en    = EXCLUDED.firstname_en,
      lastname_en     = EXCLUDED.lastname_en,
      mobile          = EXCLUDED.mobile,
      email           = EXCLUDED.email,
      national_code   = EXCLUDED.national_code,
      job_title_fa    = EXCLUDED.job_title_fa,
      job_title_en    = EXCLUDED.job_title_en,
      phone           = EXCLUDED.phone,
      industry_id     = EXCLUDED.industry_id,
      occupation_id   = EXCLUDED.occupation_id,
      country_id      = EXCLUDED.country_id,
      state_id        = EXCLUDED.state_id,
      address_fa      = EXCLUDED.address_fa,
      address_en      = EXCLUDED.address_en,
      postal_code     = EXCLUDED.postal_code,
      is_foreign      = EXCLUDED.is_foreign,
      mobile_verified = EXCLUDED.mobile_verified,
      email_verified  = EXCLUDED.email_verified,
      profile_image   = EXCLUDED.profile_image,
      raw_data        = EXCLUDED.raw_data,
      last_login_at   = NOW(),
      login_count     = app_users.login_count + 1`,
    [
      u.id ?? null,
      u.uuid,
      u.firstname_fa ?? null,
      u.lastname_fa ?? null,
      u.firstname_en ?? null,
      u.lastname_en ?? null,
      u.mobile ?? null,
      u.email ?? null,
      u.national_code ?? null,
      u.job_title_fa ?? null,
      u.job_title_en ?? null,
      u.phone ?? null,
      u.industry_id ?? null,
      u.occupation_id ?? null,
      u.country_id ?? null,
      u.state_id ?? null,
      u.address_fa ?? null,
      u.address_en ?? null,
      u.postal_code ?? null,
      u.is_foreign ?? null,
      u.mobile_verified ?? null,
      u.email_verified ?? null,
      u.profile_image ?? null,
      JSON.stringify(u),
    ]
  );
}
