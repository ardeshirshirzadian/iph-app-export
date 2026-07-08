import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { ensureAttendanceLogTable } from '@/lib/initQuestBadges';

export async function POST() {
  const cookieStore = await cookies();
  const raw = cookieStore.get('iph_user')?.value;
  let userUuid = null;
  try {
    const user = JSON.parse(decodeURIComponent(raw));
    userUuid = user?.uuid || null;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!userUuid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await ensureAttendanceLogTable();
    await query(
      `INSERT INTO quest_attendance_log (user_uuid, event_date)
       VALUES ($1, CURRENT_DATE)
       ON CONFLICT (user_uuid, event_date) DO NOTHING`,
      [userUuid]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/attendance/log]', err.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
