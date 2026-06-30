import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';

// Legacy endpoint — kept for backward compatibility.
// New code should use /api/cart/status instead.
export async function GET() {
  try {
    const bookResult = await query("SELECT value FROM app_settings WHERE key = 'book_config'");
    const bookConfig = { is_enabled: true, ...(bookResult.rows[0]?.value ?? {}) };

    if (!bookConfig.is_enabled) {
      return NextResponse.json({ is_enabled: false, has_open_cart: false, items: [], total_price: 0, price_to_pay: 0 });
    }

    const cartResult = await query("SELECT value FROM app_settings WHERE key = 'cart_config'");
    const config = {
      event_origin: 'https://2025.iphexpo.com',
      rasayesh_site: 'event',
      ...(cartResult.rows[0]?.value ?? {}),
    };

    const cookieStore = await cookies();
    const token = cookieStore.get('iph_access_token')?.value;
    if (!token) {
      return NextResponse.json({ is_enabled: true, has_open_cart: false, items: [], total_price: 0, price_to_pay: 0 });
    }

    const origin = config.event_origin;
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
        query: `query {
          getAttendeeCart {
            id
            status
            total_price
            price_to_pay
            cart_items {
              id
              entity_type
              entity_id
              price
              discounted_price
              price_to_pay
              discount
              discount_price
              snapshot
            }
          }
        }`,
      }),
      cache: 'no-store',
    });

    const data = await res.json();
    const cart = data.data?.getAttendeeCart;
    const has_open_cart = !!(cart?.id && !['paid', 'cancelled', 'expired'].includes(cart.status));

    if (has_open_cart) {
      return NextResponse.json({
        is_enabled: true,
        has_open_cart: true,
        cart_id: cart.id,
        items: cart.cart_items || [],
        total_price: cart.total_price ?? 0,
        price_to_pay: cart.price_to_pay ?? 0,
      });
    }

    return NextResponse.json({ is_enabled: true, has_open_cart: false, items: [], total_price: 0, price_to_pay: 0 });
  } catch {
    return NextResponse.json({ is_enabled: true, has_open_cart: false, items: [], total_price: 0, price_to_pay: 0 });
  }
}
