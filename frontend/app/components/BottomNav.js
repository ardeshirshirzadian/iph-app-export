"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Module-level cache: survives component unmount/remount across navigations.
// Populated on first mount, reused on all subsequent mounts — zero re-fetches.
// Resets to null on every fresh page load (new JS execution context).
let _navCache = null;

export default function BottomNav() {
  const pathname = usePathname();
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
  const items = navItems
    ? navItems.map((item) => ({ href: item.href, icon_path: item.icon_path, icon_size: item.icon_size ?? 28 }))
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
              <span
                style={{
                  display: "block",
                  width: item.icon_size,
                  height: item.icon_size,
                  backgroundColor: "currentColor",
                  WebkitMaskImage: `url('${item.icon_path}')`,
                  WebkitMaskSize: "contain",
                  WebkitMaskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskImage: `url('${item.icon_path}')`,
                  maskSize: "contain",
                  maskRepeat: "no-repeat",
                  maskPosition: "center",
                }}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
