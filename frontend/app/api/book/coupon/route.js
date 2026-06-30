import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('iph_access_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const code = (body.code ?? '').trim();
    if (!code) return NextResponse.json({ error: 'کد تخفیف را وارد کنید' }, { status: 400 });

    const configResult = await query("SELECT value FROM app_settings WHERE key = 'book_config'");
    const config = { event_origin: 'https://2025.iphexpo.com', ...(configResult.rows[0]?.value ?? {}) };
    const origin = config.event_origin;

    const safeCode = code.replace(/"/g, '');

    const res = await fetch('https://api.rasayesh.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rasayesh-site': 'event',
        'origin': origin,
        'referer': `${origin}/`,
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `mutation {
          applyDiscountCodeToAttendeeCart(discount_code: "${safeCode}")
        }`,
      }),
    });

    const data = await res.json();
    if (data.errors?.length) {
      return NextResponse.json({ error: data.errors[0]?.message || 'کد تخفیف معتبر نیست' }, { status: 400 });
    }

    const result = data.data?.applyDiscountCodeToAttendeeCart;
    if (!result) return NextResponse.json({ error: 'پاسخ نامعتبر از سرور' }, { status: 502 });

    const cart = result.cart ?? result;
    return NextResponse.json({
      ...cart,
      discount_amount: (cart.total_price ?? 0) - (cart.price_to_pay ?? 0),
    });
  } catch (error) {
    console.error('Book coupon error:', error);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
