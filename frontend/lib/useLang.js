'use client';
import { useState, useEffect } from 'react';

export function useLang() {
  const [lang, setLang] = useState('fa');

  useEffect(() => {
    setLang(localStorage.getItem('iph-lang') || 'fa');

    function onStorage(e) {
      if (e.key === 'iph-lang' && e.newValue) setLang(e.newValue);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function switchLang(newLang) {
    localStorage.setItem('iph-lang', newLang);
    setLang(newLang);
    window.dispatchEvent(new StorageEvent('storage', { key: 'iph-lang', newValue: newLang }));
  }

  return { lang, switchLang, isRTL: lang === 'fa' };
}
