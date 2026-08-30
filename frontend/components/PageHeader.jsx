"use client";
import { Suspense } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/app/components/AppHeader";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

// AppHeader calls useSearchParams() internally (only as a useEffect
// dependency, not rendered) -- Next requires that behind a Suspense boundary
// to allow the page it's rendered on to be statically/ISR-prerendered.
// Without this, every page rendering PageHeader would hard-fail the build
// the moment it (or an ancestor layout) stops being force-dynamic. No
// runtime behavior change post-hydration -- fallback={null} is effectively
// invisible since AppHeader itself renders near-instantly.
function SuspendedAppHeader(props) {
  return (
    <Suspense fallback={null}>
      <AppHeader {...props} />
    </Suspense>
  );
}

export default function PageHeader({ title, title_en, subtitle, subtitle_en, showBack = true, leftActions, rightActions, titleRowExtra, isHomeContext = false }) {
  const router = useRouter();
  const { lang, isRTL } = useLang();
  const displayTitle = (lang === 'en' && title_en) ? title_en : title;
  const displaySubtitle = (lang === 'en' && subtitle_en) ? subtitle_en : subtitle;

  if (isHomeContext) {
    return <SuspendedAppHeader leftActions={leftActions} rightActions={rightActions} />;
  }

  const titleContent = (displayTitle || displaySubtitle) && (
    <>
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
    </>
  );

  // Sizing differs by context: standalone, this box owns flex-1 to consume
  // the row's remaining width (original behavior). Alongside titleRowExtra,
  // the wrapper below owns flex-1 instead so justify-between can separate
  // title from the extra content.
  const titleBox = titleContent ? (
    <div className={titleRowExtra ? "min-w-0" : "flex-1 min-w-0"} dir={isRTL ? "rtl" : "ltr"}>
      {titleContent}
    </div>
  ) : (
    // No title/subtitle but titleRowExtra is present: keep a second flex
    // child alive so justify-between still pushes it to the end (mirrors
    // Map's original spacer-div-based layout).
    titleRowExtra && <div />
  );

  const extraBox = titleRowExtra && (
    <div className="flex items-center gap-1.5 flex-shrink-0">{titleRowExtra}</div>
  );

  return (
    <>
      <SuspendedAppHeader leftActions={leftActions} rightActions={rightActions} />
      {/* Gate must check displayTitle/displaySubtitle (the actual rendered
          content, language-resolved), not the raw fa-only `title` prop --
          title and subtitle are independently admin-clearable, so a cleared
          title must not hide a still-populated subtitle. titleRowExtra also
          keeps the row alive on its own (e.g. Map's zoom/3D controls) even
          when there's no title/subtitle to show at all. */}
      {(displayTitle || displaySubtitle || showBack || titleRowExtra) && (
        // dir="ltr" keeps the back button always on the physical LEFT regardless of
        // language -- titleBox/extraBox below swap DOM order per isRTL instead, so
        // titleRowExtra lands on the opposite physical side from the title text
        // without touching the back button's fixed placement.
        <div className={titleRowExtra ? "flex items-center justify-between mb-4" : "flex items-center gap-3 mb-4"} dir="ltr">
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
          {titleRowExtra ? (
            <div className="flex items-center justify-between flex-1 min-w-0">
              {isRTL ? <>{extraBox}{titleBox}</> : <>{titleBox}{extraBox}</>}
            </div>
          ) : (
            titleBox
          )}
        </div>
      )}
    </>
  );
}
