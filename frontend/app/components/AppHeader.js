"use client";
import Link from "next/link";

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

// Custom-link icon uses the same mask technique as bell/cart.
function linkMask(iconPath) {
  return {
    display: "block",
    width: "20px",
    height: "20px",
    backgroundColor: "currentColor",
    maskImage: `url('${iconPath}')`,
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskImage: `url('${iconPath}')`,
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    color: "var(--text)",
  };
}

const LS_KEY = "notif_last_seen";

// The fallback list mirrors the current hardcoded layout so the header
// looks identical before the API response arrives.
const DEFAULT_HEADER_ITEMS = [
  { id: "__logo", item_type: "logo", sort_order: 0, is_active: true },
  { id: "__bell", item_type: "bell", sort_order: 1, is_active: true },
  { id: "__cart", item_type: "cart", sort_order: 2, is_active: true },
];

// Module-level cache: fetched once per browser session, reused on remount.
let _headerCache = null;

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
  // Initialise from module-level cache so remounts render instantly without refetch.
  const [headerItems, setHeaderItems] = useState(_headerCache);

  useEffect(() => {
    setLastSeen(Number(localStorage.getItem(LS_KEY) || 0));
    fetch("/api/notifications")
      .then((r) => r.json())
      .then(({ notifications: rows = [] }) => setNotifications(rows))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = typeof window !== "undefined" && localStorage.getItem("access_token");
    if (!token) { setHasCart(false); return; }
    const client = getApolloClient();
    if (!client) return;
    client.query({ query: CART_HAS_ITEMS })
      .then(({ data }) => {
        const cart = data?.getAttendeeCart;
        const items = cart?.cart_items || [];
        setHasCart(!!(cart?.id && !["paid", "cancelled", "expired"].includes(cart.status) && items.length > 0));
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

  useEffect(() => {
    if (_headerCache) return; // already fetched this session — skip
    fetch("/api/header")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.items)) {
          _headerCache = d.items;
          setHeaderItems(d.items);
        }
      })
      .catch(() => {});
  }, []);

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

  // Effective item list: use fetched data once available, otherwise fallback.
  const allItems = headerItems ?? DEFAULT_HEADER_ITEMS;
  const activeItems = allItems.filter((i) => i.is_active !== false);

  const logoVisible = activeItems.some((i) => i.item_type === "logo");

  // Action items are everything except the logo, sorted by sort_order.
  const actionItemsAsc = activeItems
    .filter((i) => i.item_type !== "logo")
    .sort((a, b) => a.sort_order - b.sort_order);

  // EN mirrors FA by reversing the action-item order — matching the
  // existing hardcoded behavior (bell-cart in FA → cart-bell in EN).
  const actionItemsDesc = [...actionItemsAsc].reverse();

  // Render a single action item (bell / cart / custom link).
  function renderActionItem(item) {
    if (item.item_type === "bell") {
      return (
        <button
          key={item.id}
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
      );
    }

    if (item.item_type === "cart") {
      return (
        <button
          key={item.id}
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
      );
    }

    if (item.item_type === "link" && item.icon_path && item.href) {
      return (
        <Link
          key={item.id}
          href={item.href}
          aria-label={lang === "en" ? (item.title_en || item.title_fa || "") : (item.title_fa || "")}
          className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-transform active:scale-90 duration-150"
          style={{ ...ICON_SHELL, textDecoration: "none" }}
        >
          <span style={linkMask(item.icon_path)} />
        </Link>
      );
    }

    return null;
  }

  // The Logo block differs between FA and EN only in the internal order
  // of the logo image and app-name text — exactly as it was hardcoded.
  const logoBlockFA = logoVisible ? (
    <Link href="/" className="flex items-center gap-2" style={{ textDecoration: "none" }}>
      <span className="text-sm font-bold" style={{ color: "var(--text-muted)" }}>
        {t(lang, "app_name")}
      </span>
      <div className="h-8 w-8 flex items-center justify-center">
        <Logo className="h-8 w-auto object-contain" />
      </div>
    </Link>
  ) : null;

  const logoBlockEN = logoVisible ? (
    <Link href="/" className="flex items-center gap-2" style={{ textDecoration: "none" }}>
      <div className="h-8 w-8 flex items-center justify-center">
        <Logo className="h-8 w-auto object-contain" />
      </div>
      <span className="text-sm font-bold" style={{ color: "var(--text-muted)" }}>
        {t(lang, "app_name")}
      </span>
    </Link>
  ) : null;

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
            {/* FA: action items on LEFT (ascending sort_order), logo on RIGHT */}
            <div className="flex items-center gap-2">
              {actionItemsAsc.map(renderActionItem)}
              {leftActions}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {rightActions}
              {logoBlockFA}
            </div>
          </>
        ) : (
          <>
            {/* EN: logo on LEFT, action items on RIGHT (descending sort_order = mirrored) */}
            <div className="flex items-center gap-2 shrink-0">
              {logoBlockEN}
              {rightActions}
            </div>
            <div className="flex items-center gap-2">
              {leftActions}
              {actionItemsDesc.map(renderActionItem)}
            </div>
          </>
        )}
      </header>
    </>
  );
}
