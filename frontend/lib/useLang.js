'use client';
import { useState, useEffect } from 'react';

export function useLang() {
  const [lang, setLang] = useState('fa');
  // Default false for the SSR/initial-render pass (window is undefined
  // there, same reasoning as `lang`'s initial value above) -- corrected
  // inside the effect below once window.__IPH_LANG_LOCKED__ (set by the
  // inline script in layout.js, before hydration) is actually readable.
  const [langLocked, setLangLocked] = useState(false);

  useEffect(() => {
    const locked = typeof window !== 'undefined' && window.__IPH_LANG_LOCKED__ === true;
    setLangLocked(locked);

    if (locked) {
      setLang('fa');
      return;
    }

    setLang(localStorage.getItem('iph-lang') || 'fa');

    function onStorage(e) {
      if (e.key === 'iph-lang' && e.newValue) setLang(e.newValue);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function switchLang(newLang) {
    if (langLocked) return;
    localStorage.setItem('iph-lang', newLang);
    // Mirror into a plain host cookie (path=/, no Domain) so the server
    // (app/page.js) can read the language to pick the fa/en home-page
    // variant. Purely additive -- localStorage above stays the source of
    // truth for every client-side language decision.
    try {
      document.cookie = `iph-lang=${newLang}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
    setLang(newLang);
    window.dispatchEvent(new StorageEvent('storage', { key: 'iph-lang', newValue: newLang }));
  }

  return { lang, switchLang, isRTL: lang === 'fa', langLocked };
}
