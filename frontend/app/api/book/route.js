import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

const BOOK_CONFIG_DEFAULTS = {
  event_id: 18,
  book_id: 6,
  ipg_id: 1,
  is_enabled: true,
  title_fa: 'کتاب نمایشگاه',
  title_en: 'Exhibition Book',
};

export async function GET() {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'book_config'");
    const config = { ...BOOK_CONFIG_DEFAULTS, ...(result.rows[0]?.value ?? {}) };

    if (!config.is_enabled) {
      return NextResponse.json({ enabled: false });
    }

    return NextResponse.json({
      enabled: true,
      book_id: config.book_id,
      event_id: config.event_id,
      ipg_id: config.ipg_id,
      config: {
        title_fa: config.title_fa,
        title_en: config.title_en,
      },
    });
  } catch {
    return NextResponse.json({ enabled: true, book_id: BOOK_CONFIG_DEFAULTS.book_id, event_id: BOOK_CONFIG_DEFAULTS.event_id, ipg_id: BOOK_CONFIG_DEFAULTS.ipg_id, config: { title_fa: BOOK_CONFIG_DEFAULTS.title_fa, title_en: BOOK_CONFIG_DEFAULTS.title_en } });
  }
}
