"use client";

import { useState, useEffect } from "react";
import PageHeader from "@/components/PageHeader";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

export default function SettingsClient({ title, subtitle, title_en, subtitle_en }) {
  const [isDark, setIsDark] = useState(true);
  const { lang, switchLang, isRTL } = useLang();

  useEffect(() => {
    queueMicrotask(() => setIsDark(localStorage.getItem("iph-theme") !== "light"));
  }, []);

  function toggleTheme() {
    const next = isDark ? "light" : "dark";
    localStorage.setItem("iph-theme", next);
    document.documentElement.classList.toggle("light", next === "light");
    window.dispatchEvent(new StorageEvent("storage", { key: "iph-theme", newValue: next }));
    setIsDark(!isDark);
  }

  return (
    <main
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
      className="min-h-screen"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md mx-auto px-4 pb-16">
        <PageHeader title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />

        <div className="flex flex-col gap-3">
          {/* Appearance section */}
          <div
            className="backdrop-blur-xl border border-[var(--border)] rounded-3xl p-5"
            style={{ background: "var(--surface)" }}
          >
            <p className="text-xs font-medium mb-4" style={{ color: "var(--text-dim)" }}>
              {t(lang, "settings_appearance")}
            </p>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm leading-7" style={{ color: "var(--text)" }}>
                  {t(lang, "theme_label")}
                </p>
                <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                  {isDark ? t(lang, "theme_dark") : t(lang, "theme_light")}
                </p>
              </div>

              <button
                onClick={toggleTheme}
                aria-label={t(lang, "theme_label")}
                className="relative w-12 h-6 rounded-full transition-colors duration-300"
                style={{ background: isDark ? "var(--surface-hover)" : "var(--accent)" }}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 rounded-full shadow bg-white transition-all duration-300"
                  style={{ right: isDark ? "2px" : "26px" }}
                />
              </button>
            </div>
          </div>

          {/* Language section */}
          <div
            className="backdrop-blur-xl border border-[var(--border)] rounded-3xl p-5"
            style={{ background: "var(--surface)" }}
          >
            <p className="text-xs font-medium mb-4" style={{ color: "var(--text-dim)" }}>
              {t(lang, "language_label")}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => switchLang("fa")}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: lang === "fa" ? "var(--accent)" : "var(--surface-2)",
                  color: lang === "fa" ? "#021f20" : "var(--text-dim)",
                  border: lang === "fa" ? "none" : "1px solid var(--border)",
                }}
              >
                {t(lang, "lang_fa")}
              </button>
              <button
                onClick={() => switchLang("en")}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: lang === "en" ? "var(--accent)" : "var(--surface-2)",
                  color: lang === "en" ? "#021f20" : "var(--text-dim)",
                  border: lang === "en" ? "none" : "1px solid var(--border)",
                }}
              >
                {t(lang, "lang_en")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
