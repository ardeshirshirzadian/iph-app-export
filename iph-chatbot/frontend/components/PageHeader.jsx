"use client";
import { useRouter } from "next/navigation";
import AppHeader from "@/app/components/AppHeader";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

export default function PageHeader({ title, title_en, subtitle, subtitle_en, showBack = true, leftActions, rightActions }) {
  const router = useRouter();
  const { lang } = useLang();
  const displayTitle = (lang === 'en' && title_en) ? title_en : title;
  const displaySubtitle = (lang === 'en' && subtitle_en) ? subtitle_en : subtitle;

  return (
    <>
      <AppHeader leftActions={leftActions} rightActions={rightActions} />
      {(title || showBack) && (
        <div className="flex items-center gap-3 mb-4">
          {showBack && (
            <button
              onClick={() => router.back()}
              aria-label={t(lang, "back_aria")}
              className="flex-shrink-0 flex items-center justify-center rounded-xl transition-all active:scale-95"
              style={{
                width: 38,
                height: 38,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: 20,
              }}
            >
              ‹
            </button>
          )}
          {(displayTitle || displaySubtitle) && (
            <div className="flex-1 min-w-0">
              {displayTitle && (
                <h1 className="text-lg font-bold leading-snug" style={{ color: "var(--text)" }}>
                  {displayTitle}
                </h1>
              )}
              {displaySubtitle && (
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {displaySubtitle}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
