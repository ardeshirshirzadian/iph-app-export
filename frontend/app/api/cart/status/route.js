import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { rasayeshQuery, getTokenFromCookies } from '@/lib/rasayeshClient';

async function getCartConfig() {
  const result = await query("SELECT value FROM app_settings WHERE key = 'cart_config'");
  const defaults = { ipg_id: 1, event_origin: 'https://2025.iphexpo.com', rasayesh_site: 'event' };
  return { ...defaults, ...(result.rows[0]?.value ?? {}) };
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = getTokenFromCookies(cookieStore);
    if (!token) {
      return NextResponse.json({ has_open_cart: false, items: [], total_price: 0, price_to_pay: 0 });
    }

    const config = await getCartConfig();
    const { data, error } = await rasayeshQuery({
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
      token,
      config,
    });

    if (error) {
      return NextResponse.json({ has_open_cart: false, items: [], total_price: 0, price_to_pay: 0 });
    }

    const cart = data?.getAttendeeCart;
    const items = cart?.cart_items || [];
    const has_open_cart = !!(cart?.id && !['paid', 'cancelled', 'expired'].includes(cart.status) && items.length > 0);

    if (cart?.id) {
      return NextResponse.json({
        has_open_cart,
        cart_id: cart.id,
        items,
        total_price: cart.total_price ?? 0,
        price_to_pay: cart.price_to_pay ?? 0,
      });
    }

    return NextResponse.json({ has_open_cart: false, items: [], total_price: 0, price_to_pay: 0 });
  } catch {
    return NextResponse.json({ has_open_cart: false, items: [], total_price: 0, price_to_pay: 0 });
  }
}
