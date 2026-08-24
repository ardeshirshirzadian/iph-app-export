'use client';

import { useEffect } from 'react';

// Root error boundary: catches uncaught render exceptions in any route
// segment so the tree shows a visible retry UI instead of unmounting to a
// blank white page. layout.js's <head> (theme.css link, CSS vars) stays
// mounted when this fires, so it's safe to use var(--bg)/var(--accent)/
// var(--btn-primary-text) here -- unlike global-error.js, which replaces
// the whole document and can't rely on those being present.
export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('[error.js]', error);
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error?.message,
        stack: error?.stack,
        digest: error?.digest,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        boundary: 'error',
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        textAlign: 'center',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'inherit',
        direction: 'rtl',
      }}
    >
      <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>مشکلی پیش اومد</p>
      <button
        onClick={reset}
        style={{
          background: 'var(--accent)',
          color: 'var(--btn-primary-text)',
          border: 'none',
          borderRadius: 12,
          padding: '10px 24px',
          fontFamily: 'inherit',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        تلاش مجدد
      </button>
    </div>
  );
}
