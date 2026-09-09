'use client';
import { useEffect } from 'react';

function applyLang(lang) {
  const isRTL = lang !== 'en';
  document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  document.documentElement.classList.toggle('lang-en', lang === 'en');
}

export default function LangSync({ singleLanguage = false }) {
  useEffect(() => {
    if (singleLanguage) {
      applyLang('fa');
      return;
    }

    applyLang(localStorage.getItem('iph-lang') || 'fa');

    function onStorage(e) {
      if (e.key === 'iph-lang') applyLang(e.newValue || 'fa');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [singleLanguage]);

  // One-time additive backfill: mirror an existing localStorage language
  // preference into the iph-lang cookie so the server (app/page.js) can
  // read it to choose the fa/en home-page variant. Does NOT change how
  // language is selected, displayed, or applied to <html> above -- the
  // cookie is only consumed server-side, and only when an event has set a
  // distinct English home. No reload: the next navigation/request picks
  // it up.
  useEffect(() => {
    if (singleLanguage) return;
    try {
      const stored = localStorage.getItem('iph-lang');
      if (stored && !/(?:^|;\s*)iph-lang=/.test(document.cookie)) {
        document.cookie = `iph-lang=${stored}; path=/; max-age=31536000; samesite=lax`;
      }
    } catch {}
  }, [singleLanguage]);

  return null;
}
