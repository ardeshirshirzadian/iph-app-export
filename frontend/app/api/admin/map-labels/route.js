import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'map_labels_config'");
    return NextResponse.json({ config: result.rows[0]?.value ?? {} });
  } catch (err) {
    console.error('[api/admin/map-labels GET]', err.message);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { config } = await req.json();
    await query(
      `INSERT INTO app_settings (key, value) VALUES ('map_labels_config', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(config)]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/admin/map-labels POST]', err.message);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
