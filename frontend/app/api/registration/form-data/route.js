import { NextResponse } from 'next/server';
import { rasayeshQuery } from '@/lib/rasayeshClient';
import { query } from '@/lib/db';

async function getConfig() {
  const result = await query("SELECT value FROM app_settings WHERE key = 'registration_config'");
  const defaults = { event_origin: 'https://2025.iphexpo.com' };
  return { ...defaults, ...(result.rows[0]?.value ?? {}) };
}

export async function GET() {
  try {
    const config = await getConfig();

    const { data, error } = await rasayeshQuery({
      query: `query {
        occupations(industryId: 1) { id title_fa title_en }
        fieldOfActivities(industryId: 1) { id title_fa title_en }
        educationLevels { id title_fa title_en }
      }`,
      config: { rasayesh_site: 'iph', event_origin: config.event_origin },
    });

    if (error) return NextResponse.json({ error }, { status: 502 });

    return NextResponse.json({
      occupations: data?.occupations ?? [],
      fieldOfActivities: data?.fieldOfActivities ?? [],
      educationLevels: data?.educationLevels ?? [],
    });
  } catch (err) {
    console.error('form-data error:', err);
    return NextResponse.json({ occupations: [], fieldOfActivities: [], educationLevels: [] });
  }
}
