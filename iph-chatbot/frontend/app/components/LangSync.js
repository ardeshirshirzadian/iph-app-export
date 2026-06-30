'use client';
import { useEffect } from 'react';

function applyLang(lang) {
  const isRTL = lang !== 'en';
  document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  document.documentElement.classList.toggle('lang-en', lang === 'en');
}

export default function LangSync() {
  useEffect(() => {
    applyLang(localStorage.getItem('iph-lang') || 'fa');

    function onStorage(e) {
      if (e.key === 'iph-lang') applyLang(e.newValue || 'fa');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return null;
}
