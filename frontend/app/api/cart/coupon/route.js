import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse } from '@/lib/rasayeshClient';

async function getCartConfig() {
  const result = await query("SELECT value FROM app_settings WHERE key = 'cart_config'");
  const defaults = { event_origin: 'https://2025.iphexpo.com', rasayesh_site: 'event' };
  return { ...defaults, ...(result.rows[0]?.value ?? {}) };
}

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const token = getTokenFromCookies(cookieStore);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const code = (body.code ?? '').trim();
    if (!code) return NextResponse.json({ error: 'کد تخفیف را وارد کنید' }, { status: 400 });

    const config = await getCartConfig();
    const safeCode = code.replace(/"/g, '');

    const { data, error, unauthorized } = await rasayeshQuery({
      query: `mutation {
        applyDiscountCodeToAttendeeCart(discount_code: "${safeCode}")
      }`,
      token,
      config,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error }, { status: 400 });

    const result = data?.applyDiscountCodeToAttendeeCart;
    if (!result) return NextResponse.json({ error: 'پاسخ نامعتبر از سرور' }, { status: 502 });

    if (result?.status === 'fail') {
      return NextResponse.json({ error: result.error || 'کد تخفیف نامعتبر است' }, { status: 400 });
    }
    if (result?.status === 'invalid') {
      const firstError = Object.values(result.errors ?? {})[0]?.[0];
      return NextResponse.json({ error: firstError || 'کد تخفیف نامعتبر است' }, { status: 400 });
    }

    if (result?.status === 'success') {
      const cart = result.cart ?? result;
      return NextResponse.json({
        success: true,
        ...cart,
        discount_amount: (cart.total_price ?? 0) - (cart.price_to_pay ?? 0),
      });
    }

    const cart = result.cart ?? result;
    return NextResponse.json({
      success: true,
      ...cart,
      discount_amount: (cart.total_price ?? 0) - (cart.price_to_pay ?? 0),
    });
  } catch (error) {
    console.error('Cart coupon error:', error);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
