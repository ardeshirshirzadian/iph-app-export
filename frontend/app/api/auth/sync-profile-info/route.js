import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getInvalidProfileNameFields } from '@/lib/utils';
import { getUserDisplayNames, revalidateUserDisplayNames } from '@/lib/userDisplayNames';

// Companion to finalize-login/verify-otp's upsertAppUser and to
// sync-profile-photo -- keeps two places that are otherwise only ever
// written at LOGIN time in sync with a mid-session profile-info edit:
//   - app_users.firstname_fa/lastname_fa/firstname_en/lastname_en, the
//     event-scoped source for the signed-in attendee's display names.
//   - the iph_user cookie's name fields, retained for legacy consumers.
// Quest itself now reads the same event-scoped app_users value directly.
//
// quest_user_names deliberately does not participate: its key is globally
// user_uuid, not event-scoped, so writing it here could corrupt another
// event's display name.
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

  let firstnameFa, lastnameFa, firstnameEn, lastnameEn, occupationId, hasOccupationId, source;
  try {
    const body = await request.json();
    ({ firstnameFa, lastnameFa, firstnameEn, lastnameEn, occupationId, source } = body);
    // Older/name-only callers intentionally omit this property. Preserve the
    // stored occupation for them; AttendeeProvider always sends it, including
    // an explicit null when the attendee has cleared the field in Rasayesh.
    hasOccupationId = Object.prototype.hasOwnProperty.call(body, 'occupationId');
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const invalidNameFields = getInvalidProfileNameFields({
    firstnameFa,
    lastnameFa,
    firstnameEn,
    lastnameEn,
  });
  if (invalidNameFields.length) {
    return NextResponse.json(
      {
        error: 'Name fields must use their matching Persian or English script',
        fields: invalidNameFields,
      },
      { status: 400 }
    );
  }

  try {
    const currentEventId = await getCurrentEventId();

    // An APN correction is intentionally local to this event. Do not let the
    // provider's background Rasayesh sync overwrite it. An explicit profile
    // save is allowed to supersede it, because that is a newer attendee edit.
    const currentNames = await getUserDisplayNames(currentEventId, user.uuid);
    const preserveAdminCorrection = source === 'attendee-provider' && currentNames?.isAdminCorrection;
    const effectiveNames = preserveAdminCorrection ? currentNames : {
      firstnameFa: firstnameFa || '',
      lastnameFa: lastnameFa || '',
      firstnameEn: firstnameEn || '',
      lastnameEn: lastnameEn || '',
    };

    await query(
      `UPDATE app_users
         SET firstname_fa = $1, lastname_fa = $2, firstname_en = $3, lastname_en = $4,
             occupation_id = CASE WHEN $5 THEN $6 ELSE occupation_id END
       WHERE event_id = $7 AND uuid = $8`,
      [effectiveNames.firstnameFa || null, effectiveNames.lastnameFa || null, effectiveNames.firstnameEn || null, effectiveNames.lastnameEn || null, hasOccupationId, occupationId ?? null, currentEventId, user.uuid]
    );
    try {
      revalidateUserDisplayNames();
    } catch (error) {
      // Cache invalidation must not turn an already-committed profile edit
      // into a failed save. The Expo cache's existing five-second ceiling is
      // the safe degraded path if this process cannot revalidate.
      console.error('[auth/sync-profile-info revalidate]', error.message);
    }

    // Re-set the cookie with just the name fields merged in -- id, uuid,
    // mobile, job_title_fa, email, and tokenVersion carry over unchanged.
    // Same options finalize-login/verify-otp already use, so this doesn't
    // change the cookie's shape or lifetime semantics, only refreshes it.
    const updatedUser = {
      ...user,
      firstname_fa: effectiveNames.firstnameFa,
      lastname_fa: effectiveNames.lastnameFa,
      firstname_en: effectiveNames.firstnameEn,
      lastname_en: effectiveNames.lastnameEn,
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
