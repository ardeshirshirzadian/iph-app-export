import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse } from '@/lib/rasayeshClient';

async function getRegistrationConfig() {
  const result = await query("SELECT value FROM app_settings WHERE key = 'registration_config'");
  const defaults = { event_id: 18, event_origin: 'https://2025.iphexpo.com', is_enabled: false };
  return { ...defaults, ...(result.rows[0]?.value ?? {}) };
}

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const token = getTokenFromCookies(cookieStore);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const config = await getRegistrationConfig();
    if (!config.is_enabled) {
      return NextResponse.json({ error: 'ثبت‌نام در حال حاضر غیرفعال است' }, { status: 403 });
    }

    const body = await request.json();
    const planIds = (body.plan_ids ?? []).map(Number).filter(Boolean);
    if (planIds.length === 0) {
      return NextResponse.json({ error: 'حداقل یک پلن انتخاب کنید' }, { status: 400 });
    }

    const redirectUrl = 'https://app.iphexpo.com/cart/callback';
    const planIdsStr = planIds.join(', ');

    const { data, error, unauthorized } = await rasayeshQuery({
      query: `mutation {
        addWizardItemsToCart(
          items: { plan_ids: [${planIdsStr}] }
          redirectUrl: "${redirectUrl}"
        )
      }`,
      token,
      config: { rasayesh_site: 'event', event_origin: config.event_origin },
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error }, { status: 400 });

    const result = data?.addWizardItemsToCart;
    if (!result) return NextResponse.json({ error: 'پاسخ نامعتبر از سرور' }, { status: 502 });

    if (result.redirect_url) {
      return NextResponse.json({ needs_payment: true, redirect_url: result.redirect_url });
    }

    if (result.status === 'success' || result.success === true) {
      return NextResponse.json({ needs_payment: false, success: true });
    }

    return NextResponse.json({ needs_payment: false, success: true, result });
  } catch (err) {
    console.error('Registration register error:', err);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
