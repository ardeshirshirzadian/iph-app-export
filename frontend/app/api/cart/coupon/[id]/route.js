import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse } from '@/lib/rasayeshClient';

async function getCartConfig() {
  const result = await query("SELECT value FROM app_settings WHERE key = 'cart_config'");
  const defaults = { event_origin: 'https://2025.iphexpo.com', rasayesh_site: 'event' };
  return { ...defaults, ...(result.rows[0]?.value ?? {}) };
}

export async function DELETE(request, { params }) {
  try {
    const cookieStore = await cookies();
    const token = getTokenFromCookies(cookieStore);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const couponId = Number(id);
    if (!couponId) return NextResponse.json({ error: 'Invalid coupon id' }, { status: 400 });

    const config = await getCartConfig();
    const { error, unauthorized } = await rasayeshQuery({
      query: `mutation { deleteDiscountCodeFromAttendeeCart(id: ${couponId}) }`,
      token,
      config,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cart coupon DELETE error:', error);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
