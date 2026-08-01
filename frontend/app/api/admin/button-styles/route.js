import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyAdminToken } from '@/lib/adminAuth';
import { cookies } from 'next/headers';
import { BUTTON_DEFAULTS } from '@/lib/getButtonStyles';

function getAdmin() {
  const cookieStore = cookies();
  const token = cookieStore.get('iph_admin_session')?.value;
  return verifyAdminToken(token, process.env.ADMIN_SESSION_SECRET);
}

export async function GET() {
  if (!getAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'button_styles_config'"
    );
    const saved = result.rows[0]?.value ?? {};
    const config = {
      dark:  { ...BUTTON_DEFAULTS.dark,  ...(saved.dark  ?? {}) },
      light: { ...BUTTON_DEFAULTS.light, ...(saved.light ?? {}) },
    };
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  if (!getAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    const { config } = body;
    if (!config || typeof config !== 'object') {
      return NextResponse.json({ error: 'config required' }, { status: 400 });
    }

    await query(
      `INSERT INTO app_settings (key, value)
       VALUES ('button_styles_config', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(config)]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
