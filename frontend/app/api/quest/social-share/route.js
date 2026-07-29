import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

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
    // Check for existing PENDING submission — block duplicate pending
    const existingPending = missionId
      ? await query(
          `SELECT id FROM quest_social_share_submissions
           WHERE mission_id = $1 AND user_uuid = $2 AND status = 'pending'`,
          [missionId, userUuid]
        )
      : await query(
          `SELECT id FROM quest_social_share_submissions
           WHERE badge_id = $1 AND user_uuid = $2 AND status = 'pending'`,
          [badgeId, userUuid]
        );

    if (existingPending.rows.length > 0) {
      return NextResponse.json({ error: 'already_pending' }, { status: 409 });
    }

    // Also block if already approved (no need to resubmit)
    const existingApproved = missionId
      ? await query(
          `SELECT id FROM quest_social_share_submissions
           WHERE mission_id = $1 AND user_uuid = $2 AND status = 'approved'`,
          [missionId, userUuid]
        )
      : await query(
          `SELECT id FROM quest_social_share_submissions
           WHERE badge_id = $1 AND user_uuid = $2 AND status = 'approved'`,
          [badgeId, userUuid]
        );

    if (existingApproved.rows.length > 0) {
      return NextResponse.json({ error: 'already_approved' }, { status: 409 });
    }

    // Verify mission/badge exists and is the right type
    if (missionId) {
      const r = await query(
        `SELECT id FROM quest_content WHERE id = $1 AND mission_type = 'social_share'`,
        [missionId]
      );
      if (r.rows.length === 0) return NextResponse.json({ error: 'mission_not_found' }, { status: 404 });
    } else {
      const r = await query(
        `SELECT id FROM quest_badges WHERE id = $1 AND badge_type = 'social_share'`,
        [badgeId]
      );
      if (r.rows.length === 0) return NextResponse.json({ error: 'badge_not_found' }, { status: 404 });
    }

    await query(
      `INSERT INTO quest_social_share_submissions
         (mission_id, badge_id, user_uuid, link_url, platform, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [missionId || null, badgeId || null, userUuid, link_url.trim(), resolvedPlatform]
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
