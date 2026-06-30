import { query } from '@/lib/db';
import RegisterClient from './RegisterClient';

export const dynamic = 'force-dynamic';

const DEFAULTS = {
  title_fa: 'ثبت‌نام رویداد',
  title_en: 'Event Registration',
  subtitle_fa: 'پکیج مورد نظر خود را انتخاب کنید',
  subtitle_en: 'Select your registration package',
};

export default async function RegisterPage() {
  let config = DEFAULTS;
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'registration_config'");
    if (result.rows[0]?.value) {
      config = { ...DEFAULTS, ...result.rows[0].value };
    }
  } catch {
    // use defaults
  }

  return (
    <RegisterClient
      title={config.title_fa}
      subtitle={config.subtitle_fa}
      title_en={config.title_en}
      subtitle_en={config.subtitle_en}
    />
  );
}
