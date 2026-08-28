export const dynamic = 'force-dynamic';

import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import LoginForm from './LoginForm';

const DEFAULTS = {
  logo_path_dark_fa: '/logo/logo-l-fa.png',
  logo_path_dark_en: '/logo/logo-l-en.png',
  logo_path_light_fa: '/logo/logo-fa.png',
  logo_path_light_en: '/logo/logo-en.png',
  logo_height: '80',
  subtitle: 'ورود به حساب کاربری',
  mobile_label: 'شماره موبایل',
  mobile_placeholder: '۰۹xxxxxxxxx',
  submit_button_text: 'دریافت کد تأیید',
  sending_text: 'در حال ارسال...',
  otp_subtitle: 'کد تأیید ارسال شده به',
  verify_button_text: 'ورود',
  verifying_text: 'در حال تأیید...',
  resend_otp_text: 'ارسال مجدد کد',
  edit_mobile_text: 'ویرایش شماره موبایل',
};

// Found live during Phase 5: this query had no event_id filter at all --
// never touched in Tier 3 (that pass covered iph-apn's admin login-page
// route only; this public-facing page was never in scope). With a second
// event's login_page_settings rows now existing, both events' rows were
// read together and silently overwrote each other key-by-key in
// unpredictable row order.
async function getLoginSettings(eventId) {
  try {
    const result = await query('SELECT key, value FROM login_page_settings WHERE event_id = $1', [eventId]);
    const settings = { ...DEFAULTS };
    for (const row of result.rows) settings[row.key] = row.value;
    return settings;
  } catch {
    return DEFAULTS;
  }
}

export default async function LoginPage({ searchParams }) {
  const settings = await getLoginSettings(await getCurrentEventId());
  const sp = searchParams ? await Promise.resolve(searchParams) : {};
  return (
    <LoginForm
      settings={settings}
      initialVerify={sp.verify === '1'}
      initialContact={sp.contact || sp.mobile || sp.email || ''}
      initialIsEmail={!!sp.email || (!sp.mobile && !!(sp.contact?.includes('@')))}
      quickMode={sp.quick === 'true'}
      fromPath={sp.from || '/'}
    />
  );
}
