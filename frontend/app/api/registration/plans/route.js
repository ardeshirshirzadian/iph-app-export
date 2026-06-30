import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { rasayeshQuery } from '@/lib/rasayeshClient';

async function getRegistrationConfig() {
  const result = await query("SELECT value FROM app_settings WHERE key = 'registration_config'");
  const defaults = {
    event_id: 18,
    event_origin: 'https://2025.iphexpo.com',
    is_enabled: false,
  };
  return { ...defaults, ...(result.rows[0]?.value ?? {}) };
}

export async function GET() {
  try {
    const config = await getRegistrationConfig();

    if (!config.is_enabled) {
      return NextResponse.json({ enabled: false });
    }

    const { data, error } = await rasayeshQuery({
      query: `query GetPlans($eventId: Int!) {
        eventRegistrationPlans(eventId: $eventId) {
          id
          title_fa
          title_en
          description_fa
          description_en
          features_fa
          features_en
          icon
          color
          price
          discount
          capacity
          usage_count
          selective
          force_selection
          disabled
          order
        }
      }`,
      variables: { eventId: Number(config.event_id) },
      config: { rasayesh_site: 'iph', event_origin: config.event_origin },
    });

    if (error) {
      return NextResponse.json({ error }, { status: 502 });
    }

    const plans = (data?.eventRegistrationPlans ?? [])
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    return NextResponse.json({ enabled: true, plans, config });
  } catch (err) {
    console.error('Registration plans error:', err);
    return NextResponse.json({ error: 'خطا در دریافت پلن‌ها' }, { status: 500 });
  }
}
