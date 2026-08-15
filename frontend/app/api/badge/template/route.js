import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { fetchPublicGraphQL } from '@/lib/publicRasayeshClient';

const EVENT_TEMPLATE_QUERY = `
  query EventTemplate($id: Int!) {
    eventTemplate(id: $id) {
      id
      title
      key
      value
    }
  }
`;

// The card's visual template (background/layout) changes only when the admin
// explicitly re-saves it. PRIMARY invalidation is that save's revalidateTag
// call (iph-apn app/api/admin/badge/route.js PUT -> 'badge-card-template');
// this 300s revalidate is a safety-net ceiling only, mirroring badge-page-config.
const TTL = 300;

const getCachedTemplate = unstable_cache(
  async (templateId, eventOrigin) => {
    const res = await fetchPublicGraphQL(EVENT_TEMPLATE_QUERY, { id: templateId }, eventOrigin);
    const t = res?.data?.eventTemplate;
    if (!t?.value) return null;
    try {
      return typeof t.value === 'string' ? JSON.parse(t.value) : t.value;
    } catch {
      return null;
    }
  },
  ['badge-card-template'],
  { tags: ['badge-card-template'], revalidate: TTL }
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const templateId = Number(searchParams.get('templateId')) || 0;
  if (templateId <= 0) {
    return NextResponse.json({ template: null });
  }

  try {
    const originRes = await query("SELECT value FROM app_settings WHERE key = 'companies_config'");
    const eventOrigin = originRes.rows[0]?.value?.event_origin || 'https://2025.iphexpo.com';
    const template = await getCachedTemplate(templateId, eventOrigin);
    return NextResponse.json({ template });
  } catch (err) {
    console.error('[api/badge/template]', err?.graphQLErrors ?? err?.message ?? err);
    return NextResponse.json({ template: null }, { status: 500 });
  }
}
