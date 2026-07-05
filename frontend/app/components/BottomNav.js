"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/useLang";

const NAV_ITEMS = [
  { key: "nav_services", iconPath: "/logo/services-icon.svg", href: "/" },
  { key: "nav_badge", iconPath: "/logo/id-badge.svg", href: "/badge" },
  { key: "nav_profile", iconPath: "/logo/user.svg", href: "/profile" },
];

export default function BottomNav() {
  const pathname = usePathname();

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
        {NAV_ITEMS.map((item) => {
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
                className="w-7 h-7 block"
                style={{
                  backgroundColor: "currentColor",
                  WebkitMaskImage: `url('${item.iconPath}')`,
                  WebkitMaskSize: "contain",
                  WebkitMaskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskImage: `url('${item.iconPath}')`,
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
