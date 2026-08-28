"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/useLang";

// Module-level cache: survives component unmount/remount across navigations.
// Populated on first mount, reused on all subsequent mounts — zero re-fetches.
// Resets to null on every fresh page load (new JS execution context).
let _navCache = null;

function iconMaskStyle(iconPath, size) {
  return {
    display: "block",
    width: size,
    height: size,
    backgroundColor: "currentColor",
    WebkitMaskImage: `url('${iconPath}')`,
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskImage: `url('${iconPath}')`,
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
  };
}

export default function BottomNav() {
  const pathname = usePathname();
  const { lang } = useLang();
  // Initialise directly from cache so the component renders correctly on
  // remount without waiting for a new fetch.
  const [navItems, setNavItems] = useState(_navCache);

  useEffect(() => {
    if (_navCache) return; // already fetched this session — skip
    fetch("/api/nav")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.items) && data.items.length > 0) {
          _navCache = data.items;
          setNavItems(data.items);
        }
      })
      .catch(() => {});
  }, []);

  // Render nothing until the first real fetch resolves — avoids flashing
  // hardcoded icon paths that may differ from what admin has configured.
  // is_active=false items are already excluded server-side (app/api/nav/route.js
  // filters WHERE is_active = true) -- is_coming_soon never affects that filter.
  const items = navItems
    ? navItems.map((item) => ({
        href: item.href,
        icon_path: item.icon_path,
        icon_size: item.icon_size ?? 28,
        is_coming_soon: !!item.is_coming_soon,
        no_badge: !!item.coming_soon_no_badge,
        badge:
          lang === "en"
            ? item.coming_soon_badge_en || item.coming_soon_badge_fa || "Coming soon"
            : item.coming_soon_badge_fa || "به زودی",
      }))
    : [];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-xl border-t"
      style={{
        background: "var(--nav-bg)",
        borderColor: "var(--border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="flex">
        {items.map((item) => {
          // Coming-soon items are rendered visible but fully inert: a plain
          // div (no Link, no onClick), never navigable, never clickable.
          if (item.is_coming_soon) {
            return (
              <div
                key={item.href}
                className="relative flex-1 flex items-center justify-center py-3 select-none"
                style={{ color: "var(--text-dim)", opacity: 0.55, cursor: "default" }}
                aria-disabled="true"
              >
                <span style={iconMaskStyle(item.icon_path, item.icon_size)} />
                {!item.no_badge && (
                  <span
                    className="absolute top-0.5 rounded-full text-[9px] font-bold leading-none whitespace-nowrap"
                    style={{
                      background: "var(--accent)",
                      color: "var(--btn-primary-text)",
                      padding: "2px 6px",
                      insetInlineEnd: "10%",
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
            );
          }

          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex items-center justify-center py-3 transition-colors"
              style={{ color: active ? "var(--accent)" : "var(--text-dim)" }}
            >
              <span style={iconMaskStyle(item.icon_path, item.icon_size)} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
