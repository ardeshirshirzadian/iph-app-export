import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse } from '@/lib/rasayeshClient';

async function getBookConfig() {
  const result = await query("SELECT value FROM app_settings WHERE key = 'book_config'");
  const defaults = { event_id: 18, book_id: 6 };
  return { ...defaults, ...(result.rows[0]?.value ?? {}) };
}

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
    const book_count = Math.max(0, parseInt(body.book_count ?? 0, 10));
    const cd_count   = Math.max(0, parseInt(body.cd_count   ?? 0, 10));
    const pdf_count  = Math.max(0, parseInt(body.pdf_count  ?? 0, 10));

    if (book_count + cd_count + pdf_count === 0) {
      return NextResponse.json({ error: 'حداقل یک محصول انتخاب کنید' }, { status: 400 });
    }

    const [bookConfig, cartConfig] = await Promise.all([getBookConfig(), getCartConfig()]);
    const { data, error, unauthorized } = await rasayeshQuery({
      query: `mutation {
        addItemToCart(
          itemType: "EventExhibitionBook"
          itemId: ${Number(bookConfig.book_id)}
          metadata: {book_count: ${book_count}, cd_count: ${cd_count}, pdf_count: ${pdf_count}}
        )
      }`,
      token,
      config: cartConfig,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error }, { status: 400 });

    const result = data?.addItemToCart;
    if (!result) return NextResponse.json({ error: 'پاسخ نامعتبر از سرور' }, { status: 502 });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Book cart POST error:', error);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    const token = getTokenFromCookies(cookieStore);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const cartConfig = await getCartConfig();
    const { data, error, unauthorized } = await rasayeshQuery({
      query: `mutation { cancelAttendeeCart }`,
      token,
      config: cartConfig,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error }, { status: 400 });

    const result = data?.cancelAttendeeCart;
    return NextResponse.json({ success: !!(result?.status !== 'error'), result });
  } catch (error) {
    console.error('Book cart DELETE error:', error);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
