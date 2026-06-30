import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse } from '@/lib/rasayeshClient';

async function getCartConfig() {
  const result = await query("SELECT value FROM app_settings WHERE key = 'cart_config'");
  const defaults = { ipg_id: 1, event_origin: 'https://2025.iphexpo.com', rasayesh_site: 'event' };
  return { ...defaults, ...(result.rows[0]?.value ?? {}) };
}

function toGraphqlValue(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function metadataToGraphql(meta) {
  const keys = Object.keys(meta);
  if (keys.length === 0) return '{}';
  return `{${keys.map((k) => `${k}: ${toGraphqlValue(meta[k])}`).join(', ')}}`;
}

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const token = getTokenFromCookies(cookieStore);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { itemType, itemId, metadata = {} } = body;
    if (!itemType || itemId == null) {
      return NextResponse.json({ error: 'itemType and itemId are required' }, { status: 400 });
    }

    const config = await getCartConfig();
    const { data, error, unauthorized } = await rasayeshQuery({
      query: `mutation {
        addItemToCart(
          itemType: "${itemType}"
          itemId: ${Number(itemId)}
          metadata: ${metadataToGraphql(metadata)}
        )
      }`,
      token,
      config,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error }, { status: 400 });

    return NextResponse.json({ success: true, result: data?.addItemToCart });
  } catch (error) {
    console.error('Cart add error:', error);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
