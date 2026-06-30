export const dynamic = 'force-dynamic';

import { query } from '@/lib/db';
import LoginForm from './LoginForm';

const DEFAULTS = {
  logo_path: '/logo/logo-l.png',
  logo_path_light_theme: '/logo/logo.png',
  logo_size: '80',
  title: 'ایران فارما',
  subtitle: 'ورود به حساب کاربری',
  mobile_label: 'شماره موبایل',
  mobile_placeholder: '۰۹xxxxxxxxx',
  submit_button_text: 'دریافت کد تأیید',
  sending_text: 'در حال ارسال...',
  otp_title: 'کد تأیید را وارد کنید',
  otp_subtitle: 'کد تأیید ارسال شده به',
  otp_code_label: 'کد تأیید ۵ رقمی',
  verify_button_text: 'ورود',
  verifying_text: 'در حال تأیید...',
  resend_otp_text: 'ارسال مجدد کد',
  edit_mobile_text: 'ویرایش شماره موبایل',
};

async function getLoginSettings() {
  try {
    const result = await query('SELECT key, value FROM login_page_settings');
    const settings = { ...DEFAULTS };
    for (const row of result.rows) settings[row.key] = row.value;
    return settings;
  } catch {
    return DEFAULTS;
  }
}

export default async function LoginPage() {
  const settings = await getLoginSettings();
  return <LoginForm settings={settings} />;
}
