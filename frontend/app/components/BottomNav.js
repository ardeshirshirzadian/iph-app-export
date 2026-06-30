"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

const NAV_ITEMS = [
  { key: "nav_services", iconPath: "/logo/services-icon.svg", href: "/" },
  { key: "nav_badge", iconPath: "/logo/id-badge.svg", href: "/badge" },
  { key: "nav_profile", iconPath: "/logo/user.svg", href: "/profile" },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { lang } = useLang();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50">
      <div className="max-w-md mx-auto px-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <div
          className="backdrop-blur-xl border border-[var(--border)] rounded-3xl p-1 flex gap-1"
          style={{ background: "var(--nav-bg)" }}
        >
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl text-[10px] font-medium transition-all ${
                  active
                    ? "bg-[#00ffb3]/15 text-[var(--accent)]"
                    : "text-[var(--text-dim)] hover:text-[var(--text-muted)]"
                }`}
              >
                <span
                  className="w-6 h-6 block"
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
                <span>{t(lang, item.key)}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
