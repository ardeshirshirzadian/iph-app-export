const FA = '۰۱۲۳۴۵۶۷۸۹';

export function toLocalMobile(mobile) {
  if (!mobile) return '';
  if (mobile.startsWith('+98')) return '0' + mobile.slice(3);
  if (mobile.startsWith('98') && mobile.length === 12) return '0' + mobile.slice(2);
  return mobile;
}

export function toPersianDigits(str) {
  return String(str).replace(/[0-9]/g, (d) => FA[d]);
}

export function toEnglishDigits(str) {
  if (!str) return '';
  return String(str)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function toPersianRelativeTime(isoString) {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 1) return 'همین الان';
    if (mins < 60) return toPersianDigits(mins) + ' دقیقه پیش';
    if (hours < 24) return toPersianDigits(hours) + ' ساعت پیش';
    if (days === 1) return 'دیروز';
    if (days < 30) return toPersianDigits(days) + ' روز پیش';
    return new Date(isoString).toLocaleDateString('fa-IR');
  } catch {
    return '';
  }
}

export function toRelativeTime(isoString, lang) {
  if (lang === 'fa') return toPersianRelativeTime(isoString);
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
