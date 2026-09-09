import 'server-only';
import { query } from './db';
import { getCurrentEventId } from './currentEvent';

// Platform-specific "how to turn notifications back on" help text shown on
// /settings when the browser has blocked push. One JSON blob per event under
// app_settings key 'push_guides', edited in iph-apn's /notifications admin
// (PushGuidesCard). Mirrors getPushPrompt.js. DEFAULT must stay in sync with
// DEFAULT_VALUE in iph-apn app/api/admin/notifications/push-guides/route.js.
const DEFAULT = {
  ios_fa: 'برای دریافت اعلان‌ها روی آیفون (iOS ۱۶.۴ یا بالاتر) ابتدا باید اپ را به صفحه اصلی اضافه کنید: در Safari دکمه Share را بزنید ← «Add to Home Screen» ← Add، سپس اپ را از صفحه اصلی باز کنید و هنگام درخواست «Allow» را بزنید. اگر قبلاً رد کرده‌اید، به «تنظیمات» گوشی ← Notifications بروید، اپ را با نامش در فهرست پیدا کنید و «Allow Notifications» را روشن کنید (در iOS ۱۸ ممکن است زیر Settings ← Apps هم باشد). برای وب‌اپ نصب‌شده، تنظیم جداگانه‌ای داخل خود Safari وجود ندارد.',
  ios_en: 'To get notifications on iPhone (iOS 16.4 or later) you must first add the app to your Home Screen: in Safari tap Share → "Add to Home Screen" → Add, then open the app from your Home Screen and tap "Allow" when prompted. If you already declined, open the iOS Settings app → Notifications, find the app by its name in the list, and turn on "Allow Notifications" (on iOS 18 it may also appear under Settings → Apps). There is no separate per-site toggle inside Safari itself for an installed web app.',
  android_fa: 'در کروم اندروید، اگر درخواست اعلان را رد کرده‌اید: روی نوار آدرس ← آیکون اطلاعات سایت (ⓘ یا آیکون تنظیمات) بزنید ← Permissions ← Notifications ← Allow و سپس صفحه را دوباره بارگذاری کنید (یا از منوی ⋮ ← Settings ← Site settings ← Notifications). اگر اپ را نصب کرده‌اید، به «تنظیمات» اندروید ← Apps ← این اپ ← Notifications بروید و آن را روشن کنید. در اندروید ۱۳ به بعد ممکن است لازم باشد اجازه اعلان در سطح سیستم را نیز برای کروم یا اپ روشن کنید تا اعلان‌ها نمایش داده شوند.',
  android_en: 'In Chrome on Android, if you declined the notification prompt: tap the address bar → the site info icon (ⓘ or the settings/tune icon) → Permissions → Notifications → Allow, then reload the page (or ⋮ menu → Settings → Site settings → Notifications). If you installed the app, go to Android Settings → Apps → this app → Notifications and turn it on. On Android 13 and later you may also need to allow notifications at the system level for Chrome or the app before any notifications appear.',
};

// eventId: pass explicitly from inside an unstable_cache-wrapped call site --
// see lib/getActiveFont.js for why.
export async function getPushGuides(eventId) {
  try {
    eventId = eventId ?? await getCurrentEventId();
    const { rows } = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'push_guides'",
      [eventId]
    );
    if (!rows[0]?.value) return DEFAULT;
    return { ...DEFAULT, ...rows[0].value };
  } catch {
    return DEFAULT;
  }
}
