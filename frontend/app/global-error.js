'use client';

import { useEffect } from 'react';

// Catches errors thrown by the root layout itself (app/error.js can't --
// per Next.js's documented requirement, this file must render its own
// <html>/<body>, replacing the whole document). Because the root layout is
// what failed, none of its <head> output (the /api/theme.css link, the
// per-event CSS vars) can be assumed to exist -- so unlike app/error.js,
// this uses hardcoded fallback colors instead of var(--accent) etc.
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[global-error.js]', error);
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error?.message,
        stack: error?.stack,
        digest: error?.digest,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        boundary: 'global-error',
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="fa" dir="rtl">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 24,
            textAlign: 'center',
            background: '#021f20',
            color: '#ffffff',
            fontFamily: 'sans-serif',
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>مشکلی پیش اومد</p>
          <button
            onClick={reset}
            style={{
              background: '#00ffb3',
              color: '#021f20',
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
      </body>
    </html>
  );
}
