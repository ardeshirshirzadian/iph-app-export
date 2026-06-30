import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('iph_access_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const configResult = await query("SELECT value FROM app_settings WHERE key = 'cart_config'");
    const config = {
      event_origin: 'https://2025.iphexpo.com',
      rasayesh_site: 'event',
      ipg_id: 1,
      ...(configResult.rows[0]?.value ?? {}),
    };
    const origin = config.event_origin;

    const ipgId = Number(config.ipg_id);
    const redirectUrl = 'https://app.iphexpo.com/cart/callback';

    const res = await fetch('https://api.rasayesh.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rasayesh-site': config.rasayesh_site || 'event',
        'origin': origin,
        'referer': `${origin}/`,
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `mutation {
          requestAttendeeCartPayment(ipgId: ${ipgId}, redirectUrl: "${redirectUrl}")
        }`,
      }),
    });

    const data = await res.json();
    if (data.errors?.length) {
      return NextResponse.json({ error: data.errors[0]?.message || 'خطا در ایجاد پرداخت' }, { status: 400 });
    }

    const result = data.data?.requestAttendeeCartPayment;
    if (!result?.redirect_url) {
      return NextResponse.json({ error: 'آدرس پرداخت دریافت نشد' }, { status: 502 });
    }

    return NextResponse.json({ redirect_url: result.redirect_url });
  } catch (error) {
    console.error('Book payment error:', error);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
