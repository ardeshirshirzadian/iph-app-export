import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { cookies } from 'next/headers';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'درخواست نامعتبر' }, { status: 400 });
  }

  const { endpoint, keys } = body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'اطلاعات اشتراک ناقص است' }, { status: 400 });
  }

  // Pull user_uuid from the readable user cookie when available (may be absent)
  let userUuid = null;
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('iph_user')?.value;
    if (raw) userUuid = JSON.parse(raw).uuid || null;
  } catch {
    // Proceed without uuid
  }

  try {
    await query(
      `INSERT INTO push_subscriptions (user_uuid, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_uuid = EXCLUDED.user_uuid,
             p256dh    = EXCLUDED.p256dh,
             auth      = EXCLUDED.auth`,
      [userUuid, endpoint, keys.p256dh, keys.auth]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[push/subscribe]', err.message);
    return NextResponse.json({ error: 'خطای سرور' }, { status: 500 });
  }
}
