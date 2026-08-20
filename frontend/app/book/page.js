import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import BookClient from './BookClient';

export const dynamic = 'force-dynamic';

const DEFAULTS = {
  title_fa: 'کتاب نمایشگاه',
  title_en: 'Exhibition Book',
  subtitle_fa: 'خرید کتاب نمایشگاه ایران فارما',
  subtitle_en: 'IranPharma Exhibition Book Purchase',
};

export default async function BookPage() {
  let config = DEFAULTS;
  try {
    const currentEventId = await getCurrentEventId();
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'book_config'",
      [currentEventId]
    );
    if (result.rows[0]?.value) {
      config = { ...DEFAULTS, ...result.rows[0].value };
    }
  } catch {
    // use defaults
  }

  return (
    <BookClient
      title={config.title_fa}
      subtitle={config.subtitle_fa || ''}
      title_en={config.title_en}
      subtitle_en={config.subtitle_en || ''}
    />
  );
}
