import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'registration_config'");
    const defaults = { event_id: 18, is_enabled: false };
    const config = { ...defaults, ...(result.rows[0]?.value ?? {}) };

    if (!config.is_enabled) {
      return NextResponse.json({ enabled: false });
    }

    return NextResponse.json({ enabled: true, event_id: Number(config.event_id) });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
