import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

// Companion to finalize-login/verify-otp's upsertAppUser and to
// sync-profile-photo -- keeps two places that are otherwise only ever
// written at LOGIN time in sync with a mid-session profile-info edit:
//   - app_users.firstname_fa/lastname_fa/firstname_en/lastname_en, which
//     leaderboard/route.js reads as its name source (COALESCE'd after
//     quest_user_names, see below) -- see 2026-09-14 investigation.
//   - the iph_user cookie's name fields, which api/quest/stats/route.js
//     reads directly to build the Quest page's name box.
// Fired fire-and-forget from EditProfileClient's saveInfo() -- a sync
// failure here must never block the user from seeing their own edit
// succeed, same rationale as sync-profile-photo.
//
// Also refreshes quest_user_names.display_name_fa/en when a row already
// exists for this user (created at their most recent booth scan, see
// scan/route.js's cacheUserName()) -- leaderboard/route.js's COALESCE
// checks quest_user_names BEFORE app_users, so leaving a stale
// quest_user_names row in place would keep the leaderboard stale even
// after app_users is fixed. Deliberately UPDATE-only here too (never
// upserts a new quest_user_names row) -- cacheUserName() at scan time
// stays that table's sole row-creation path, unchanged; a user who has
// never scanned a booth has no row to update, which is fine, since
// leaderboard's COALESCE falls through to the now-fresh app_users values
// for them anyway.
export async function POST(request) {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;

  let user;
  try {
    user = JSON.parse(decodeURIComponent(userRaw));
  } catch {
    user = null;
  }
  if (!user?.uuid) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }

  let firstnameFa, lastnameFa, firstnameEn, lastnameEn, occupationId, hasOccupationId;
  try {
    const body = await request.json();
    ({ firstnameFa, lastnameFa, firstnameEn, lastnameEn, occupationId } = body);
    // Older/name-only callers intentionally omit this property. Preserve the
    // stored occupation for them; AttendeeProvider always sends it, including
    // an explicit null when the attendee has cleared the field in Rasayesh.
    hasOccupationId = Object.prototype.hasOwnProperty.call(body, 'occupationId');
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  try {
    const currentEventId = await getCurrentEventId();

    await query(
      `UPDATE app_users
         SET firstname_fa = $1, lastname_fa = $2, firstname_en = $3, lastname_en = $4,
             occupation_id = CASE WHEN $5 THEN $6 ELSE occupation_id END
       WHERE event_id = $7 AND uuid = $8`,
      [firstnameFa || null, lastnameFa || null, firstnameEn || null, lastnameEn || null, hasOccupationId, occupationId ?? null, currentEventId, user.uuid]
    );

    const displayNameFa = [firstnameFa, lastnameFa].filter(Boolean).join(' ') || null;
    const displayNameEn = [firstnameEn, lastnameEn].filter(Boolean).join(' ') || null;
    await query(
      `UPDATE quest_user_names
         SET display_name_fa = $1, display_name_en = $2, updated_at = NOW()
       WHERE user_uuid = $3`,
      [displayNameFa, displayNameEn, user.uuid]
    );

    // Re-set the cookie with just the name fields merged in -- id, uuid,
    // mobile, job_title_fa, email, and tokenVersion carry over unchanged.
    // Same options finalize-login/verify-otp already use, so this doesn't
    // change the cookie's shape or lifetime semantics, only refreshes it.
    const updatedUser = {
      ...user,
      firstname_fa: firstnameFa,
      lastname_fa: lastnameFa,
      firstname_en: firstnameEn,
      lastname_en: lastnameEn,
    };
    cookieStore.set('iph_user', JSON.stringify(updatedUser), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[auth/sync-profile-info]', err.message);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
