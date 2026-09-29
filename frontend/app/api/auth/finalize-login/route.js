import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { extractProfilePhotoUrl, isNameValidForLang } from '@/lib/utils';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getOrCreateReferralCode } from '@/lib/referralCode';
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SEC } from '@/lib/userSession';

const RASAYESH_GRAPHQL = 'https://api.rasayesh.com/graphql';
// The ONLY confirmed-working pattern for calling Rasayesh anywhere in this
// codebase is lib/apolloClient.js's createRasayeshFetch(), used by every
// client-side call (LoginForm, AttendeeProvider, cart, booking, ...) -- and
// it always sends these four headers alongside the Bearer token.
const RASAYESH_ATTENDEE_HEADERS = {
  'x-rasayesh-site': 'attendee',
  origin: 'https://attendee.rasayesh.com',
  referer: 'https://attendee.rasayesh.com/',
  lang: 'fa',
};

// This route used to take the ENTIRE `user` object (including uuid) straight
// from the client's own POST body and mint a session for it with zero
// re-verification -- anyone could POST an arbitrary uuid, with no OTP, no
// mobile, nothing, and get a fully valid session for it. Now: the client
// sends only the Rasayesh accessToken it already holds, and this route asks
// Rasayesh itself, server-side, who it belongs to (getAttendee) -- uuid and
// every other identity field come from THAT response, never from the
// request body. A forged, expired, or someone-else's token simply fails the
// Rasayesh call and login is rejected.
export async function POST(request) {
  let accessToken;
  try {
    ({ accessToken } = await request.json());
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!accessToken || typeof accessToken !== 'string') {
    return Response.json({ error: 'Missing accessToken' }, { status: 400 });
  }

  let res;
  try {
    res = await fetch(RASAYESH_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        ...RASAYESH_ATTENDEE_HEADERS,
      },
      body: JSON.stringify({
        query: `query Me {
          getAttendee {
            id
            uuid
            firstname_fa
            lastname_fa
            firstname_en
            lastname_en
            mobile
            email
            job_title_fa
            profile
          }
        }`,
      }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error('[auth/finalize-login] Rasayesh fetch failed:', err.name, err.message);
    return Response.json({ error: 'خطا در ارتباط با سرور' }, { status: 502 });
  }

  const rawBody = await res.text();
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error(
      '[auth/finalize-login] Rasayesh response was not valid JSON. status=' + res.status,
      'body:', rawBody.slice(0, 1000)
    );
    return Response.json({ error: 'خطا در ارتباط با سرور' }, { status: 502 });
  }

  const { data, errors } = payload;
  if (errors?.length || !data?.getAttendee?.uuid) {
    console.error(
      '[auth/finalize-login] getAttendee rejected the token. status=' + res.status,
      'errors:', JSON.stringify(errors)
    );
    return Response.json({ error: 'invalid_token' }, { status: 401 });
  }

  const u = data.getAttendee;

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
  cookieStore.set('iph_user', JSON.stringify(userPayload), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  // Resolved here (inside the request scope, before the fire-and-forget
  // call below) rather than inside upsertAppUser -- getCurrentEventId()
  // reads next/headers, which is only valid while the request is in
  // flight. upsertAppUser keeps running after this handler returns, so
  // calling it there could hit headers() outside a request scope.
  const currentEventId = await getCurrentEventId();

  cookieStore.set(
    SESSION_COOKIE_NAME,
    createSessionToken({ uuid: u.uuid, event_id: currentEventId, tokenVersion }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SEC,
    }
  );

  // Fire-and-forget: upsert into app_users — never block login on this
  upsertAppUser(u, currentEventId).catch((err) =>
    console.error('[app_users upsert error]', err)
  );

  return Response.json({ success: true });
}

async function upsertAppUser(u, eventId) {
  const firstnameFaValid = isNameValidForLang(u.firstname_fa, 'fa');
  const lastnameFaValid = isNameValidForLang(u.lastname_fa, 'fa');
  const firstnameEnValid = isNameValidForLang(u.firstname_en, 'en');
  const lastnameEnValid = isNameValidForLang(u.lastname_en, 'en');

  // RETURNING (xmax = 0) AS was_inserted -- the standard Postgres idiom for
  // telling a fresh INSERT apart from an ON CONFLICT DO UPDATE in one
  // statement (xmax is only left at 0 by a real insert). Used below to
  // eagerly generate this user's referral code exactly once, at the moment
  // their app_users row is first created -- never on a later login/update.
  const { rows } = await query(
    `INSERT INTO app_users (
      event_id, rasayesh_id, uuid, firstname_fa, lastname_fa, firstname_en, lastname_en,
      mobile, email, national_code, job_title_fa, job_title_en, phone,
      industry_id, occupation_id, country_id, state_id,
      address_fa, address_en, postal_code, is_foreign,
      mobile_verified, email_verified, profile_image, raw_data,
      first_login_at, last_login_at, login_count
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
      NOW(), NOW(), 1
    )
    ON CONFLICT (event_id, uuid) DO UPDATE SET
      rasayesh_id     = EXCLUDED.rasayesh_id,
      firstname_fa    = CASE WHEN $26 THEN EXCLUDED.firstname_fa ELSE app_users.firstname_fa END,
      lastname_fa     = CASE WHEN $27 THEN EXCLUDED.lastname_fa ELSE app_users.lastname_fa END,
      firstname_en    = CASE WHEN $28 THEN EXCLUDED.firstname_en ELSE app_users.firstname_en END,
      lastname_en     = CASE WHEN $29 THEN EXCLUDED.lastname_en ELSE app_users.lastname_en END,
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
      login_count     = app_users.login_count + 1
    RETURNING (xmax = 0) AS was_inserted`,
    [
      eventId,
      u.id ?? null,
      u.uuid,
      firstnameFaValid ? (u.firstname_fa ?? null) : null,
      lastnameFaValid ? (u.lastname_fa ?? null) : null,
      firstnameEnValid ? (u.firstname_en ?? null) : null,
      lastnameEnValid ? (u.lastname_en ?? null) : null,
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
      extractProfilePhotoUrl(u.profile),
      JSON.stringify(u),
      firstnameFaValid,
      lastnameFaValid,
      firstnameEnValid,
      lastnameEnValid,
    ]
  );

  if (rows[0]?.was_inserted) {
    // Brand-new user this event -- generate their referral code now. Every
    // pre-existing user (was_inserted false, this was an UPDATE) gets theirs
    // lazily instead, the first time they open the referral mission card
    // (see referral/my-code/route.js) -- no backfill migration needed.
    getOrCreateReferralCode(eventId, u.uuid).catch((err) =>
      console.error('[referral code eager-generation error]', err)
    );
  }
}
