"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import Toast from "@/components/Toast";
import { toPersianDigits } from "@/lib/utils";
import { useNotificationSocket } from "@/lib/socketClient";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

const BELL_MASK = {
  display: "block",
  width: "20px",
  height: "20px",
  backgroundColor: "currentColor",
  maskImage: "url('/logo/bell.svg')",
  maskSize: "contain",
  maskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskImage: "url('/logo/bell.svg')",
  WebkitMaskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  color: "var(--text)",
};

const BELL_SHELL = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
};

const LS_KEY = "notif_last_seen";

export default function AppHeader({ leftActions, rightActions }) {
  const router = useRouter();
  const pathname = usePathname();
  const onNotifPage = pathname === "/notifications";
  const { lang } = useLang();

  const [notifications, setNotifications] = useState([]);
  const [lastSeen, setLastSeen] = useState(0);
  const [liveToast, setLiveToast] = useState(null);

  useEffect(() => {
    setLastSeen(Number(localStorage.getItem(LS_KEY) || 0));
    fetch("/api/notifications")
      .then((r) => r.json())
      .then(({ notifications: rows = [] }) => setNotifications(rows))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (onNotifPage) {
      const now = Date.now();
      localStorage.setItem(LS_KEY, String(now));
      setLastSeen(now);
    }
  }, [onNotifPage]);

  const handleRefresh = useCallback(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then(({ notifications: rows = [] }) => setNotifications(rows))
      .catch(() => {});
  }, []);

  const handleLive = useCallback((notif) => {
    setNotifications((prev) => [notif, ...prev]);
    setLiveToast(notif);
  }, []);

  useNotificationSocket(handleLive, handleRefresh);

  const unreadCount = onNotifPage
    ? 0
    : notifications.filter((n) => new Date(n.created_at).getTime() > lastSeen).length;

  function handleBellClick() {
    if (!onNotifPage) router.push("/notifications");
  }

  const badgeLabel = unreadCount > 9
    ? (lang === "fa" ? "۹+" : "9+")
    : lang === "fa" ? toPersianDigits(unreadCount) : String(unreadCount);

  return (
    <>
      {liveToast && (
        <Toast
          message={liveToast.title}
          icon={liveToast.icon || "📢"}
          onDismiss={() => setLiveToast(null)}
        />
      )}

      <header
        dir="ltr"
        className="flex items-center py-4"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        {/* Left: bell always first, optional leftActions */}
        <div className="flex-1 flex items-center gap-2">
          <button
            aria-label={t(lang, "notifications_label")}
            onClick={handleBellClick}
            className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-transform active:scale-90 duration-150"
            style={BELL_SHELL}
          >
            <span style={BELL_MASK} />
            {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold leading-none"
                style={{ background: "var(--accent)", color: "#021f20" }}
              >
                {badgeLabel}
              </span>
            )}
          </button>
          {leftActions}
        </div>

        {/* Center: logo + app name */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-8 w-8 flex items-center justify-center">
            <Logo className="h-8 w-auto object-contain" />
          </div>
          <span className="text-sm font-bold" style={{ color: "var(--text-muted)" }}>
            {t(lang, "app_name")}
          </span>
        </div>

        {/* Right: optional action or spacer */}
        <div className="flex-1 flex items-center justify-end">
          {rightActions || <div className="w-9 h-9" />}
        </div>
      </header>
    </>
  );
}
