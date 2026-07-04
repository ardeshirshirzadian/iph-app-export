import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

const RASAYESH_GQL = 'https://api.rasayesh.com/graphql';

function parseTemplate(result) {
  if (!result) return null;
  try {
    return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
  } catch {
    return result.value ?? null;
  }
}

// GET /api/admin/badge/template-preview?id=X
// Admin auth + 'badge' permission enforced by proxy.js.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const templateId = Number(searchParams.get('id')) || 0;
  if (!templateId) {
    return NextResponse.json({ error: 'Missing template id' }, { status: 400 });
  }

  try {
    const configResult = await query(
      "SELECT value FROM app_settings WHERE key = 'companies_config'"
    );
    const config = configResult.rows[0]?.value ?? {};
    const eventOrigin = config.event_origin ?? 'https://2025.iphexpo.com';

    const res = await fetch(RASAYESH_GQL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rasayesh-site': 'iph',
        'origin': eventOrigin,
        'referer': `${eventOrigin}/`,
      },
      body: JSON.stringify({
        query: `{ eventTemplate(id: ${templateId}) { key value } }`,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Rasayesh returned ${res.status}` },
        { status: 502 }
      );
    }

    const json = await res.json();
    if (json.errors?.length) {
      return NextResponse.json({ error: json.errors[0].message }, { status: 502 });
    }

    const template = parseTemplate(json.data?.eventTemplate);
    return NextResponse.json({ template });
  } catch (err) {
    console.error('[admin/badge/template-preview]', err.message);
    return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 });
  }
}
