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
          style={{
            background: "rgba(5,64,65,0.88)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(0,255,179,0.28)",
            borderRadius: "18px",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            color: "#fff",
            fontSize: "14px",
            fontWeight: 500,
            boxShadow: "0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,255,179,0.08)",
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
