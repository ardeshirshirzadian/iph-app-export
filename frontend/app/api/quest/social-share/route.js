import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

const VALID_PLATFORMS = ['Instagram', 'Telegram', 'WhatsApp', 'Other'];

function isValidUrl(s) {
  if (!s || typeof s !== 'string') return false;
  return /^https?:\/\/.{2,}\..{2,}/.test(s.trim());
}

export async function POST(request) {
  const cookieStore = await cookies();
  const userRaw = cookieStore.get('iph_user')?.value;
  let userUuid;
  try {
    const user = JSON.parse(decodeURIComponent(userRaw));
    userUuid = user?.uuid || null;
  } catch {
    userUuid = null;
  }
  if (!userUuid) return NextResponse.json({ error: 'session_expired' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { missionId, badgeId, link_url, platform } = body || {};

  if (!missionId && !badgeId) {
    return NextResponse.json({ error: 'missionId or badgeId required' }, { status: 400 });
  }
  if (!isValidUrl(link_url)) {
    return NextResponse.json({ error: 'لینک وارد شده معتبر نیست. باید با http:// یا https:// شروع شود.' }, { status: 422 });
  }
  const resolvedPlatform = VALID_PLATFORMS.includes(platform) ? platform : null;

  try {
    const currentEventId = await getCurrentEventId();

    // Check for existing PENDING submission — block duplicate pending
    const existingPending = missionId
      ? await query(
          `SELECT id FROM quest_social_share_submissions
           WHERE mission_id = $1 AND user_uuid = $2 AND status = 'pending' AND event_id = $3`,
          [missionId, userUuid, currentEventId]
        )
      : await query(
          `SELECT id FROM quest_social_share_submissions
           WHERE badge_id = $1 AND user_uuid = $2 AND status = 'pending' AND event_id = $3`,
          [badgeId, userUuid, currentEventId]
        );

    if (existingPending.rows.length > 0) {
      return NextResponse.json({ error: 'already_pending' }, { status: 409 });
    }

    // Also block if already approved (no need to resubmit)
    const existingApproved = missionId
      ? await query(
          `SELECT id FROM quest_social_share_submissions
           WHERE mission_id = $1 AND user_uuid = $2 AND status = 'approved' AND event_id = $3`,
          [missionId, userUuid, currentEventId]
        )
      : await query(
          `SELECT id FROM quest_social_share_submissions
           WHERE badge_id = $1 AND user_uuid = $2 AND status = 'approved' AND event_id = $3`,
          [badgeId, userUuid, currentEventId]
        );

    if (existingApproved.rows.length > 0) {
      return NextResponse.json({ error: 'already_approved' }, { status: 409 });
    }

    // Verify mission/badge exists, is the right type, AND belongs to the
    // current event -- missionId/badgeId come straight from the client, so
    // without the event_id check here a request could reference another
    // event's content and still succeed, scoped to (and polluting) this event.
    if (missionId) {
      const r = await query(
        `SELECT id FROM quest_content WHERE id = $1 AND mission_type = 'social_share' AND event_id = $2`,
        [missionId, currentEventId]
      );
      if (r.rows.length === 0) return NextResponse.json({ error: 'mission_not_found' }, { status: 404 });
    } else {
      const r = await query(
        `SELECT id FROM quest_badges WHERE id = $1 AND badge_type = 'social_share' AND event_id = $2`,
        [badgeId, currentEventId]
      );
      if (r.rows.length === 0) return NextResponse.json({ error: 'badge_not_found' }, { status: 404 });
    }

    await query(
      `INSERT INTO quest_social_share_submissions
         (mission_id, badge_id, user_uuid, link_url, platform, status, event_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [missionId || null, badgeId || null, userUuid, link_url.trim(), resolvedPlatform, currentEventId]
    );

    return NextResponse.json({ ok: true, status: 'pending' });
  } catch (err) {
    console.error('[quest/social-share POST]', err.message);
    if (err.code === '23505') {
      return NextResponse.json({ error: 'already_pending' }, { status: 409 });
    }
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
