"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import Logo from "@/components/Logo";
import Toast from "@/components/Toast";
import { toPersianDigits } from "@/lib/utils";
import { useNotificationSocket } from "@/lib/socketClient";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

const CART_HAS_ITEMS = gql`
  query { getAttendeeCart { id status cart_items { id } } }
`;

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

const CART_MASK = {
  display: "block",
  width: "20px",
  height: "20px",
  backgroundColor: "currentColor",
  maskImage: "url('/logo/cart.svg')",
  maskSize: "contain",
  maskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskImage: "url('/logo/cart.svg')",
  WebkitMaskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  color: "var(--text)",
};

const ICON_SHELL = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
};

const LS_KEY = "notif_last_seen";

export default function AppHeader({ leftActions, rightActions }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onNotifPage = pathname === "/notifications";
  const { lang, isRTL } = useLang();

  const [notifications, setNotifications] = useState([]);
  const [lastSeen, setLastSeen] = useState(0);
  const [liveToast, setLiveToast] = useState(null);
  const [hasCart, setHasCart] = useState(false);

  useEffect(() => {
    setLastSeen(Number(localStorage.getItem(LS_KEY) || 0));
    fetch("/api/notifications")
      .then((r) => r.json())
      .then(({ notifications: rows = [] }) => setNotifications(rows))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = typeof window !== 'undefined' && localStorage.getItem('access_token');
    if (!token) { setHasCart(false); return; }
    const client = getApolloClient();
    if (!client) return;
    client.query({ query: CART_HAS_ITEMS })
      .then(({ data }) => {
        const cart = data?.getAttendeeCart;
        const items = cart?.cart_items || [];
        setHasCart(!!(cart?.id && !['paid', 'cancelled', 'expired'].includes(cart.status) && items.length > 0));
      })
      .catch(() => setHasCart(false));
  }, [pathname, searchParams]);

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
        className="flex items-center justify-between py-4"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        {isRTL ? (
          <>
            {/* FA: Icons on LEFT, Logo on RIGHT */}
            <div className="flex items-center gap-2">
              <button
                aria-label={t(lang, "notifications_label")}
                onClick={handleBellClick}
                className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-transform active:scale-90 duration-150"
                style={ICON_SHELL}
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
              <button
                aria-label={t(lang, "book_cart_icon_aria")}
                onClick={() => router.push("/cart")}
                className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-transform active:scale-90 duration-150"
                style={ICON_SHELL}
              >
                <span style={CART_MASK} />
                {hasCart && (
                  <span
                    className="absolute rounded-full"
                    style={{ width: 8, height: 8, top: -2, right: -2, background: "#ef4444", border: "2px solid var(--bg)" }}
                  />
                )}
              </button>
              {leftActions}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {rightActions}
              <span className="text-sm font-bold" style={{ color: "var(--text-muted)" }}>
                {t(lang, "app_name")}
              </span>
              <div className="h-8 w-8 flex items-center justify-center">
                <Logo className="h-8 w-auto object-contain" />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* EN: Logo on LEFT, Icons on RIGHT */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="h-8 w-8 flex items-center justify-center">
                <Logo className="h-8 w-auto object-contain" />
              </div>
              <span className="text-sm font-bold" style={{ color: "var(--text-muted)" }}>
                {t(lang, "app_name")}
              </span>
              {rightActions}
            </div>

            <div className="flex items-center gap-2">
              {leftActions}
              <button
                aria-label={t(lang, "book_cart_icon_aria")}
                onClick={() => router.push("/cart")}
                className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-transform active:scale-90 duration-150"
                style={ICON_SHELL}
              >
                <span style={CART_MASK} />
                {hasCart && (
                  <span
                    className="absolute rounded-full"
                    style={{ width: 8, height: 8, top: -2, right: -2, background: "#ef4444", border: "2px solid var(--bg)" }}
                  />
                )}
              </button>
              <button
                aria-label={t(lang, "notifications_label")}
                onClick={handleBellClick}
                className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-transform active:scale-90 duration-150"
                style={ICON_SHELL}
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
            </div>
          </>
        )}
      </header>
    </>
  );
}
