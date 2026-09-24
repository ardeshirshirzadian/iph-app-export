const FA = '۰۱۲۳۴۵۶۷۸۹';

const RASAYESH_BASE = 'https://api.rasayesh.com/';

// Profile names are validated, rather than filtered on keydown/onChange, so
// paste, autofill and IME composition retain exactly what the user entered
// and receive a clear error when the script is wrong. Names are alphabetic
// only plus ZWNJ (the Persian "half-space", U+200C) -- mobile Persian
// keyboards routinely auto-insert it in compound names/surnames, and since
// it's invisible, rejecting it silently blocked account creation for real
// users (2026-09-24 incident) even though the form looked fully filled in.
// No other punctuation, digits, or combining marks are allowed.
const PERSIAN_NAME_RE = /^[\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u06FA-\u06FF\u200C ]+$/u;
const ENGLISH_NAME_RE = /^[A-Za-z ]+$/;

// Some mobile keyboards insert U+00A0 (non-breaking space) instead of a
// regular space after an autocomplete suggestion -- also invisible, also
// silently failed PERSIAN_NAME_RE/ENGLISH_NAME_RE (neither allows it) and
// shouldn't be persisted as-is. Collapse it to a normal space, along with
// any resulting/typed-in double spaces, before validating or submitting.
export function normalizeName(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\u00A0/g, ' ').replace(/ {2,}/g, ' ').trim();
}

export function isNameValidForLang(value, script) {
  // Name-requiredness is owned by the existing forms. This helper only
  // enforces the script rule, so legacy/incomplete profiles can still sync
  // blank fields without silently altering any stored data.
  if (value == null || value === '') return true;
  if (typeof value !== 'string') return false;
  return (script === 'en' ? ENGLISH_NAME_RE : PERSIAN_NAME_RE).test(normalizeName(value));
}

export function getInvalidProfileNameFields({ firstnameFa, lastnameFa, firstnameEn, lastnameEn }) {
  return [
    ['firstnameFa', firstnameFa, 'fa'],
    ['lastnameFa', lastnameFa, 'fa'],
    ['firstnameEn', firstnameEn, 'en'],
    ['lastnameEn', lastnameEn, 'en'],
  ].filter(([, value, script]) => !isNameValidForLang(value, script)).map(([field]) => field);
}

// Single source of truth for the error text shown next to an invalid name
// field, so the three copies of this message (login/registration,
// register/profile, profile/edit) can't drift out of sync with
// PERSIAN_NAME_RE/ENGLISH_NAME_RE above the way they previously did.
export function nameScriptError(field, uiIsEnglish) {
  const isPersianField = field.endsWith('Fa');
  if (uiIsEnglish) {
    return isPersianField
      ? 'Persian names can only contain Persian/Arabic-script letters and spaces.'
      : 'English names can only contain Latin letters and spaces.';
  }
  return isPersianField
    ? 'نام فارسی فقط می‌تواند شامل حروف فارسی/عربی و فاصله باشد.'
    : 'نام انگلیسی فقط می‌تواند شامل حروف لاتین و فاصله باشد.';
}

// Mirrors the profile?.jpg?.['128'] pattern used in ProfileClient.jsx.
// Tries jpg → webp → png, largest size first, returns absolute URL or null.
export function extractProfilePhotoUrl(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const formats = ['jpg', 'webp', 'png'];
  const sizes = ['256', '128', '64'];
  for (const fmt of formats) {
    if (!profile[fmt] || typeof profile[fmt] !== 'object') continue;
    for (const size of sizes) {
      const path = profile[fmt][size];
      if (path && typeof path === 'string') {
        return RASAYESH_BASE + path;
      }
    }
  }
  return null;
}

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
