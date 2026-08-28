import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { extractProfilePhotoUrl } from '@/lib/utils';
import { getCurrentEventId } from '@/lib/currentEvent';

// Lightweight companion to finalize-login's upsertAppUser -- keeps
// app_users.profile_image fresh when a photo changes MID-SESSION (e.g. via
// EditProfileClient's photo upload, which goes straight to Rasayesh and
// never otherwise touches this app's server), which finalize-login alone
// can't catch since it only runs at actual login.
//
// Fired fire-and-forget from AttendeeProvider's fetchAttendee on every
// successful resolution (once per login, and again on every explicit
// refetch() -- e.g. right after a photo upload) -- never a poll/cron, it
// only rides a request that was already happening anyway.
//
// Deliberately UPDATE-only (never upserts a new row) and never touches
// quest_user_names -- scan/route.js's cacheUserName() stays that table's
// sole writer, per its documented person-level-cache design. Safe because
// leaderboard/route.js's resolvePhotoUrl now checks app_users.profile_image
// first, so this is the effective source of truth already.
export async function POST(request) {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;

  let uuid = null;
  try {
    uuid = JSON.parse(decodeURIComponent(userRaw))?.uuid || null;
  } catch {}
  if (!uuid) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
  }

  let profile;
  try {
    ({ profile } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const profileImage = extractProfilePhotoUrl(profile);
  if (!profileImage) {
    // Nothing to sync yet (no photo on the account) -- not an error.
    return NextResponse.json({ success: true, updated: false });
  }

  try {
    const currentEventId = await getCurrentEventId();
    const result = await query(
      `UPDATE app_users SET profile_image = $1 WHERE event_id = $2 AND uuid = $3`,
      [profileImage, currentEventId, uuid]
    );
    return NextResponse.json({ success: true, updated: result.rowCount > 0 });
  } catch (err) {
    console.error('[auth/sync-profile-photo]', err.message);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
