"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SessionExpiredToast() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [redirectTo, setRedirectTo] = useState('/');

  useEffect(() => {
    function handler(e) {
      const dest = e.detail?.redirectTo || '/';
      setRedirectTo(dest);
      setVisible(true);
      setTimeout(() => {
        setVisible(false);
        router.push('/login?from=' + encodeURIComponent(dest));
      }, 2000);
    }
    window.addEventListener('session-expired', handler);
    return () => window.removeEventListener('session-expired', handler);
  }, [router]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99999,
        background: 'rgba(239,68,68,0.95)',
        color: '#fff',
        padding: '12px 24px',
        borderRadius: 16,
        fontSize: 14,
        fontWeight: 700,
        textAlign: 'center',
        pointerEvents: 'none',
        maxWidth: 'calc(100vw - 32px)',
        fontFamily: 'inherit',
        direction: 'rtl',
      }}
    >
      جلسه شما منقضی شده، لطفاً دوباره وارد شوید
    </div>
  );
}
