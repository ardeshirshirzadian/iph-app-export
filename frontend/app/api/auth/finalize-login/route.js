import { cookies } from 'next/headers';
import { query } from '@/lib/db';

export async function POST(request) {
  let user;
  try {
    ({ user } = await request.json());
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!user?.uuid) {
    return Response.json({ error: 'Missing user data' }, { status: 400 });
  }

  let tokenVersion = 1;
  try {
    const tvResult = await query(
      "SELECT value FROM app_settings WHERE key = 'auth_token_version'",
      []
    );
    tokenVersion = tvResult.rows[0]?.value?.version ?? 1;
  } catch {
    // Non-fatal: default to 1
  }

  const userPayload = {
    id: user.id,
    uuid: user.uuid,
    firstname_fa: user.firstname_fa,
    lastname_fa: user.lastname_fa,
    firstname_en: user.firstname_en,
    lastname_en: user.lastname_en,
    mobile: user.mobile,
    job_title_fa: user.job_title_fa,
    email: user.email,
    tokenVersion,
  };

  const cookieStore = await cookies();
  cookieStore.set('iph_user', JSON.stringify(userPayload), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  // Fire-and-forget: upsert into app_users — never block login on this
  upsertAppUser(user).catch((err) =>
    console.error('[app_users upsert error]', err)
  );

  return Response.json({ success: true });
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
