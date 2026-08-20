import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';

const DEFAULTS = {
  greeting_fa: 'سلام 👋 من دستیار هوش مصنوعی نمایشگاه ایران فارما هستم. چطور می‌تونم کمکتون کنم؟',
  greeting_en: "Hello 👋 I'm the IranPharma exhibition AI assistant. How can I help you?",
  subtitle_fa: 'پاسخ‌گویی بر اساس پایگاه دانش',
  subtitle_en: 'Knowledge Base Powered',
  placeholder_fa: 'سوال خود را درباره نمایشگاه بپرسید...',
  placeholder_en: 'Ask about the exhibition...',
  badge_fa: 'نسخه MVP',
  badge_en: 'MVP',
  footer_fa: 'پاسخ‌ها بر اساس اطلاعات ثبت‌شده در پایگاه دانش نمایشگاه ارائه می‌شوند.',
  footer_en: 'Answers are based on information in the exhibition knowledge base.',
};

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'chatbot_widget_config'",
      [currentEventId]
    );
    const config = result.rows[0]?.value ?? {};
    const merged = {};
    for (const key of Object.keys(DEFAULTS)) {
      merged[key] = config[key] || DEFAULTS[key];
    }
    return NextResponse.json(merged);
  } catch (error) {
    console.error('Chat widget config GET error:', error);
    return NextResponse.json({ error: 'Failed to get chat widget config' }, { status: 500 });
  }
}
