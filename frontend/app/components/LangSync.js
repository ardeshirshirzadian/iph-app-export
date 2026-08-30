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

  return null;
}
