import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const { rows } = await query(
      'SELECT id, icon, title, description, is_default, image_path, link, icon_size, created_at FROM notifications ORDER BY created_at DESC'
    );
    return NextResponse.json({ notifications: rows });
  } catch (e) {
    console.error('[notifications GET]', e.message);
    return NextResponse.json({ notifications: [] });
  }
}
