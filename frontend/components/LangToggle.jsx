'use client';
import { useLang } from '@/lib/useLang';

export default function LangToggle({ className = '' }) {
  const { lang, switchLang } = useLang();

  return (
    <button
      onClick={() => switchLang(lang === 'fa' ? 'en' : 'fa')}
      aria-label="Switch language"
      className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold transition-all active:scale-95 ${className}`}
      style={{
        background: 'var(--surface-2)',
        borderColor: 'var(--border)',
        color: 'var(--text-dim)',
      }}
    >
      <span style={{ color: lang === 'fa' ? 'var(--accent)' : 'var(--text-dim)' }}>فا</span>
      <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
      <span style={{ color: lang === 'en' ? 'var(--accent)' : 'var(--text-dim)' }}>EN</span>
    </button>
  );
}
