import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

const DEFAULTS = {
  title_fa: 'سبد خرید',
  title_en: 'Shopping Cart',
  subtitle_fa: '',
  subtitle_en: '',
  empty_cart_fa: 'سبد خرید شما خالی است',
  empty_cart_en: 'Your cart is empty',
  logo_icon_type: 'emoji',
  logo_icon_value: '🛒',
  logo_icon_size: 48,
};

export async function GET() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'cart_config'");
    const raw = result.rows[0]?.value ?? {};
    // Return only display-facing fields — never expose rasayesh_site or ipg_id
    const config = {
      title_fa: raw.title_fa ?? DEFAULTS.title_fa,
      title_en: raw.title_en ?? DEFAULTS.title_en,
      subtitle_fa: raw.subtitle_fa ?? DEFAULTS.subtitle_fa,
      subtitle_en: raw.subtitle_en ?? DEFAULTS.subtitle_en,
      empty_cart_fa: raw.empty_cart_fa ?? DEFAULTS.empty_cart_fa,
      empty_cart_en: raw.empty_cart_en ?? DEFAULTS.empty_cart_en,
      logo_icon_type: raw.logo_icon_type ?? DEFAULTS.logo_icon_type,
      logo_icon_value: raw.logo_icon_value ?? DEFAULTS.logo_icon_value,
      logo_icon_size: raw.logo_icon_size ?? DEFAULTS.logo_icon_size,
    };
    return NextResponse.json({ config });
  } catch {
    return NextResponse.json({ config: DEFAULTS });
  }
}
