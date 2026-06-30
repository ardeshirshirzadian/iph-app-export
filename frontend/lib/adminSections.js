// Single source of truth for all admin panel sections.
// When adding a new /apn/[section] page:
//   1. Add one entry here — dashboard card, permission checkboxes, and route
//      protection all derive from this list automatically.
//   2. Register any /api/admin/[prefix] routes in API_SECTION_PREFIXES in proxy.js.
// Admins management (/apn/admins) is super-admin-only and NOT in this list.
export const ADMIN_SECTIONS = [
  {
    key: 'chatbot',
    label: 'مدیریت چت‌بات',
    path: '/apn/chatbot',
    icon: '💬',
    desc: 'لاگ مکالمات و آمار',
  },
  {
    key: 'app-settings',
    label: 'تنظیمات اپلیکیشن',
    path: '/apn/app-settings',
    icon: '⚙️',
    desc: 'عنوان مرورگر، آیکون اپ و فاوآیکون',
  },
  {
    key: 'appearance',
    label: 'تنظیمات ظاهری',
    path: '/apn/appearance',
    icon: '🎨',
    desc: 'مدیریت فونت‌ها و رنگ‌های اپلیکیشن',
  },
  {
    key: 'services',
    label: 'سرویس‌ها و بنرها',
    path: '/apn/services',
    icon: '🧩',
    desc: 'افزودن و ویرایش سرویس‌های صفحه اصلی',
  },
  {
    key: 'quest',
    label: 'مدیریت کوئست',
    path: '/apn/quest',
    icon: '🏆',
    desc: 'ویرایش محتوای استاتیک صفحه کوئست',
  },
  {
    key: 'users',
    label: 'کاربران',
    path: '/apn/users',
    icon: '👥',
    desc: 'مدیریت بازدیدکنندگان',
  },
  {
    key: 'login-page',
    label: 'مدیریت صفحه ورود',
    path: '/apn/login-page',
    icon: '🔐',
    desc: 'ویرایش متون، لوگو و محتوای صفحه لاگین',
  },
  {
    key: 'notifications',
    label: 'نوتیفیکیشن‌ها',
    path: '/apn/notifications',
    icon: '🔔',
    desc: 'ارسال و مدیریت اعلان‌های فوری برای همه کاربران',
  },
  {
    key: 'companies',
    label: 'شرکت‌های نمایشگاه',
    path: '/apn/companies',
    icon: '🏢',
    desc: 'همگام‌سازی و مدیریت شرکت‌های نمایشگاهی',
  },
  {
    key: 'panels',
    label: 'پنل‌ها و کارگاه‌ها',
    path: '/apn/panels',
    icon: '🎤',
    desc: 'همگام‌سازی و مدیریت پنل‌ها، کارگاه‌ها و سخنرانان',
  },
  {
    key: 'badge',
    label: 'کارت بازدیدکننده',
    path: '/apn/badge',
    icon: '🪪',
    desc: 'مدیریت عنوان، لوگو و فیلدهای کارت بازدیدکننده',
  },
  {
    key: 'book',
    label: 'کتاب نمایشگاه',
    path: '/apn/book',
    icon: '📚',
    desc: 'مدیریت فروش کتاب نمایشگاه',
  },
  {
    key: 'cart',
    label: 'سبد خرید',
    path: '/apn/cart',
    icon: '🛒',
    desc: 'مدیریت درگاه پرداخت، متون و آیکون سبد خرید',
  },
  {
    key: 'registration',
    label: 'ثبت‌نام رویداد',
    path: '/apn/registration',
    icon: '📋',
    desc: 'تنظیمات صفحه ثبت‌نام و مدیریت پلن‌های رویداد',
  },
];
