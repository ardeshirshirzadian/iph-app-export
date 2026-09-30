"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/useLang";

export default function Toast({ message, icon = '👋', onDismiss }) {
  const [phase, setPhase] = useState("enter"); // enter | visible | exit
  const { isRTL } = useLang();

  useEffect(() => {
    const visibleTimer = setTimeout(() => setPhase("exit"), 3400);
    const doneTimer = setTimeout(() => {
      setPhase("gone");
      onDismiss?.();
    }, 4000);
    return () => {
      clearTimeout(visibleTimer);
      clearTimeout(doneTimer);
    };
  }, [onDismiss]);

  if (phase === "gone") return null;

  return (
    <>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(-50%) translateY(-20px) scale(0.95); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0)     scale(1); }
        }
        @keyframes toast-out {
          from { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1); }
          to   { opacity: 0; transform: translateX(-50%) translateY(-12px) scale(0.97); }
        }
        /* Plain var(--bg)/var(--accent) fallback declared BEFORE the
           color-mix() one, standard CSS graceful-degradation: a browser
           that doesn't understand color-mix() ignores that whole
           declaration and keeps the plain one instead of falling through
           to no background/border at all. Can't do this with a React
           inline style object (duplicate keys collapse to one) -- hence a
           real stylesheet rule here instead of style={{...}} for just
           these three properties. var(--bg) (not --surface) for the
           fallback specifically because it's always a solid opaque hex
           per event/theme (see getThemeColors.js) -- --surface itself
           already carries its own alpha, so it wouldn't guarantee opaque/
           readable on its own the way the color-mix version does.
        */
        .iph-toast-panel {
          background: var(--bg);
          background: color-mix(in srgb, var(--surface) 88%, transparent);
          border: 1px solid var(--accent);
          border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
          box-shadow: 0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px var(--accent);
          box-shadow: 0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent);
        }
      `}</style>
      <div
        dir={isRTL ? "rtl" : "ltr"}
        style={{
          position: "fixed",
          top: "max(1rem, env(safe-area-inset-top))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          animation: phase === "exit"
            ? "toast-out 0.6s ease forwards"
            : "toast-in 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards",
          pointerEvents: "none",
        }}
      >
        <div
          className="iph-toast-panel"
          style={{
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderRadius: "18px",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            color: "var(--text)",
            fontSize: "14px",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: "18px" }}>{icon}</span>
          <span>{message}</span>
        </div>
      </div>
    </>
  );
}
