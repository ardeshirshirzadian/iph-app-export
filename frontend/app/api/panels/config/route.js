import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'panels_config'");
    const config = result.rows[0]?.value ?? {};
    return NextResponse.json({
      eventId: config.event_id ?? null,
      logoBaseUrl: config.logo_base_url ?? '',
      eventOrigin: config.event_origin ?? 'https://2025.iphexpo.com',
      visibleFields: config.visible_fields ?? {},
      visibleFieldsEn: config.visible_fields_en ?? {},
      eventName: config.event_name ?? '',
      eventNameEn: config.event_name_en ?? '',
    });
  } catch (error) {
    console.error('Panels config GET error:', error);
    return NextResponse.json({ error: 'Failed to get panels config' }, { status: 500 });
  }
}
