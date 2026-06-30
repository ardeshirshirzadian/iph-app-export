import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

const BOOK_CONFIG_DEFAULTS = {
  event_id: 18,
  book_id: 6,
  event_origin: 'https://2025.iphexpo.com',
  ipg_id: 1,
  is_enabled: true,
  title_fa: 'کتاب نمایشگاه',
  title_en: 'Exhibition Book',
};

const RASAYESH_BASE = 'https://api.rasayesh.com/';

function resolveImageUrl(imageObj, sizes) {
  if (!imageObj || typeof imageObj !== 'object') return null;
  for (const size of sizes) {
    const path = imageObj?.webp?.[size] || imageObj?.jpg?.[size];
    if (path) return RASAYESH_BASE + path;
  }
  return null;
}

async function getBookConfig() {
  const result = await query("SELECT value FROM app_settings WHERE key = 'book_config'");
  return { ...BOOK_CONFIG_DEFAULTS, ...(result.rows[0]?.value ?? {}) };
}

export async function GET() {
  try {
    const config = await getBookConfig();
    if (!config.is_enabled) {
      return NextResponse.json({ enabled: false });
    }

    const origin = config.event_origin || 'https://2025.iphexpo.com';
    const res = await fetch('https://api.rasayesh.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rasayesh-site': 'event',
        'origin': origin,
        'referer': `${origin}/`,
      },
      body: JSON.stringify({
        query: `query GetBook($eventId: Int!) {
          eventExhibitionBook(eventId: $eventId) {
            id title_fa title_en description_fa description_en
            publisher_fa publisher_en page_count
            thumbnail cover
            book_price book_discount book_capacity book_usage_count
            cd_price cd_discount cd_capacity cd_usage_count
            pdf_price pdf_discount pdf_capacity pdf_usage_count
          }
        }`,
        variables: { eventId: Number(config.event_id) },
      }),
      cache: 'no-store',
    });

    const body = await res.json();
    if (body.errors?.length) {
      console.error('Rasayesh book error:', body.errors);
      return NextResponse.json({ enabled: true, book: null, error: 'Failed to fetch book data' });
    }

    const book = body.data?.eventExhibitionBook ?? null;
    if (book) {
      book.cover = resolveImageUrl(book.cover, ['640', '480', '320']);
      book.thumbnail = resolveImageUrl(book.thumbnail, ['256', '128', '64']);
    }
    return NextResponse.json({
      enabled: true,
      book,
      config: {
        title_fa: config.title_fa,
        title_en: config.title_en,
      },
    });
  } catch (error) {
    console.error('Book GET error:', error);
    return NextResponse.json({ enabled: true, book: null, error: 'Server error' }, { status: 500 });
  }
}
