import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse } from '@/lib/rasayeshClient';

async function getCartConfig() {
  const result = await query("SELECT value FROM app_settings WHERE key = 'cart_config'");
  const defaults = { ipg_id: 1, event_origin: 'https://2025.iphexpo.com', rasayesh_site: 'event' };
  return { ...defaults, ...(result.rows[0]?.value ?? {}) };
}

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const token = getTokenFromCookies(cookieStore);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const config = await getCartConfig();
    const ipgId = Number(config.ipg_id ?? 1);
    const redirectUrl = body.redirectUrl || 'https://app.iphexpo.com/cart/callback';

    const { data, error, unauthorized } = await rasayeshQuery({
      query: `mutation {
        requestAttendeeCartPayment(ipgId: ${ipgId}, redirectUrl: "${redirectUrl}")
      }`,
      token,
      config,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error }, { status: 400 });

    const result = data?.requestAttendeeCartPayment;
    if (!result?.redirect_url) {
      return NextResponse.json({ error: 'آدرس پرداخت دریافت نشد' }, { status: 502 });
    }

    return NextResponse.json({ redirect_url: result.redirect_url });
  } catch (error) {
    console.error('Cart payment error:', error);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
