import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { rasayeshQuery, getTokenFromCookies, sessionExpiredResponse, getEventConfig } from '@/lib/rasayeshClient';

const IRANPHARMA_EVENT_IDS = [1, 6, 14, 18, 26];

function parseSnapshot(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function buildDescription(cartItems) {
  if (!cartItems?.length) return { fa: null, en: null };

  const parts_fa = [];
  const parts_en = [];

  for (const item of cartItems) {
    const snap = parseSnapshot(item.snapshot);
    switch (item.entity_type) {
      case 'EventExhibitionBook': {
        const fa = snap.title_fa || snap.title || 'کتاب نمایشگاه';
        const en = snap.title_en || snap.title || 'Exhibition Book';
        parts_fa.push(`خرید کتاب: ${fa}`);
        parts_en.push(`Book: ${en}`);
        break;
      }
      case 'EventRegistrationPlan': {
        const fa = snap.title_fa || snap.title || 'طرح ثبت‌نام';
        const en = snap.title_en || snap.title || 'Registration Plan';
        parts_fa.push(`ثبت‌نام: ${fa}`);
        parts_en.push(`Registration: ${en}`);
        break;
      }
      case 'EventPanel': {
        const fa = snap.title_fa || snap.title || 'پنل';
        const en = snap.title_en || snap.title || 'Panel';
        parts_fa.push(`ثبت‌نام پنل: ${fa}`);
        parts_en.push(`Panel: ${en}`);
        break;
      }
      default:
        break;
    }
  }

  if (!parts_fa.length) return { fa: null, en: null };
  return { fa: parts_fa.join('، '), en: parts_en.join(', ') };
}

export async function GET() {
  const cookieStore = await cookies();
  const token = getTokenFromCookies(cookieStore);

  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const config = await getEventConfig();
    const { data, error, unauthorized } = await rasayeshQuery({
      query: `{ attendeeTransactions { id total_price discounted_price discount_price price_paid status success verification_status uuid created_at event { id title_fa title_en } cart { id cart_items { entity_type entity_id snapshot } } } }`,
      token,
      config,
    });

    if (unauthorized) return sessionExpiredResponse();
    if (error) return NextResponse.json({ error: 'GraphQL error' }, { status: 502 });

    const transactions = [...(data?.attendeeTransactions ?? [])]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .filter(t =>
        IRANPHARMA_EVENT_IDS.includes(Number(t.event?.id)) &&
        (t.total_price > 0 || t.discount_price > 0)
      )
      .map(t => {
        const desc = buildDescription(t.cart?.cart_items);
        return {
          id: t.id,
          uuid: t.uuid,
          total_price: t.total_price,
          discounted_price: t.discounted_price,
          discount_price: t.discount_price,
          price_paid: t.price_paid,
          status: t.status,
          success: t.success,
          verification_status: t.verification_status,
          created_at: t.created_at,
          event_name: t.event?.title_fa ?? null,
          items_description_fa: desc.fa,
          items_description_en: desc.en,
        };
      });

    return NextResponse.json({ transactions, count: transactions.length });
  } catch (err) {
    console.error('[user/transactions]', err.message);
    return NextResponse.json({ error: 'خطا در سرور' }, { status: 500 });
  }
}
