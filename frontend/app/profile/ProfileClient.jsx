"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BottomNav from "../components/BottomNav";
import { linkMask } from "../components/AppHeader";
import { useAttendee } from "../components/AttendeeProvider";
import PageHeader from "@/components/PageHeader";
import ProfileCompletionBar from "../components/ProfileCompletionBar";
import Button from "@/components/Button";
import { useAuth } from "../../hooks/useAuth";
import { toPersianDigits } from "@/lib/utils";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

const RASAYESH_BASE = "https://api.rasayesh.com/";

function maskNationalCode(code, lang) {
  if (!code || code.length < 7) return code;
  const masked = code.slice(0, 3) + "***" + code.slice(6);
  return lang === "fa" ? toPersianDigits(masked) : masked;
}

function normalizePhone(mobile, lang) {
  if (!mobile) return mobile;
  const normalized = mobile.startsWith('+98') ? '0' + mobile.slice(3) : mobile;
  return lang === "fa" ? toPersianDigits(normalized) : normalized;
}

function isSvgIconPath(path) {
  return typeof path === "string" && path.startsWith("/") && path.toLowerCase().endsWith(".svg");
}

// Colorable SVG for the "contact support" button, admin-configured via
// profile_support_link_config -- same CSS mask-image + backgroundColor
// technique as BadgeClient.jsx's HeaderButtonIcon / QuestClient.js's
// QuestIcon (no fetch/inline SVG markup, so nothing here needs sanitizing).
function SupportLinkIcon({ path, size, colorDark, colorLight }) {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
    const observer = new MutationObserver(() => {
      setIsLight(document.documentElement.classList.contains("light"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const color = isLight ? (colorLight || "#0f172a") : (colorDark || "#ffffff");

  return (
    <span style={{
      display: "block", width: size, height: size, flexShrink: 0,
      backgroundColor: color,
      WebkitMaskImage: `url('${path}')`, WebkitMaskSize: "contain",
      WebkitMaskRepeat: "no-repeat", WebkitMaskPosition: "center",
      maskImage: `url('${path}')`, maskSize: "contain",
      maskRepeat: "no-repeat", maskPosition: "center",
    }} />
  );
}

function SkeletonBlock({ className }) {
  return (
    <div
      className={`animate-pulse rounded-2xl ${className}`}
      style={{ background: "var(--surface)" }}
    />
  );
}

// Admin-configurable via header_items (item_type: 'settings') — same table
// AppHeader.js reads for bell/cart/logo/profile_pic, fetched here separately
// since this icon renders standalone on the profile page, outside AppHeader.
const GEAR_BUTTON_CLASS = "w-9 h-9 rounded-xl flex items-center justify-center transition-transform active:scale-90 duration-150";
const GEAR_BUTTON_STYLE = { background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-muted)" };

function GearIcon({ lang }) {
  const [settingsItem, setSettingsItem] = useState(null);
  // Distinct from settingsItem === null (which also means "no row found" or
  // "fetch failed") — tracks only whether the /api/header fetch has settled,
  // so loading vs. settled-with-no-override can be told apart below.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/header")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.items)) {
          setSettingsItem(d.items.find((i) => i.item_type === "settings") || null);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // Admin explicitly disabled the entry point — hide it, matching how bell/
  // cart/profile_pic respect is_active in AppHeader.js. settingsItem is only
  // ever populated once the fetch resolves, so this is naturally false
  // throughout the loading window below.
  if (settingsItem?.is_active === false) return null;

  // Still loading — never flash the default SVG (or a stale render) before
  // we actually know whether the admin configured a custom icon. Render a
  // neutral pulsing placeholder, matching this button's own dimensions,
  // until the fetch settles — same skeleton-over-flash approach used for
  // the chat widget's subtitle/badge/placeholder/footer text.
  if (!ready) {
    return (
      <div className={`${GEAR_BUTTON_CLASS} animate-pulse`} style={GEAR_BUTTON_STYLE} aria-hidden="true">
        <span className="block rounded-full" style={{ width: 20, height: 20, background: "var(--border)" }} />
      </div>
    );
  }

  // Settled: either a real admin-uploaded icon_path, or genuinely none —
  // in which case the hardcoded gear SVG is the final state, not a flash.
  const iconSize = settingsItem?.icon_size ?? 20;

  return (
    <Link
      href="/settings"
      aria-label={t(lang, "settings_aria")}
      className={GEAR_BUTTON_CLASS}
      style={GEAR_BUTTON_STYLE}
    >
      {settingsItem?.icon_path ? (
        <span style={{ ...linkMask(settingsItem.icon_path), width: iconSize, height: iconSize }} />
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.01 7.01 0 0 0-1.62-.94l-.36-2.54A.484.484 0 0 0 14 2h-3.84a.47.47 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.47a.472.472 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
        </svg>
      )}
    </Link>
  );
}

export default function ProfileClient({ title, subtitle, title_en, subtitle_en, isHomeContext = false, showBack = true, supportLink = null }) {
  const { logout } = useAuth();
  const router = useRouter();
  const { attendee: attendeeData, loading: profileLoading, refetch } = useAttendee();
  const { lang, isRTL } = useLang();

  // Inert by default -- an empty/unconfigured target_url means "admin hasn't
  // set this up yet", so the whole section stays out of the tree rather than
  // rendering a dead button. Unlike BadgeClient's header button, the icon
  // alone never gates this (it always has a real default, see
  // lib/profileSupportLinkCache.js's PROFILE_SUPPORT_LINK_DEFAULTS).
  const supportLinkVisible = Boolean(supportLink?.target_url);
  const isExternalSupportTarget = /^https?:\/\//i.test(supportLink?.target_url || '');
  const supportLinkIconEl = supportLink?.icon && supportLink.icon.startsWith('/') ? (
    isSvgIconPath(supportLink.icon)
      ? <SupportLinkIcon path={supportLink.icon} size={supportLink.icon_size} colorDark={supportLink.color_dark} colorLight={supportLink.color_light} />
      : <img src={supportLink.icon} alt="" style={{ width: supportLink?.icon_size, height: supportLink?.icon_size, objectFit: "contain" }} />
  ) : (
    <span style={{ fontSize: supportLink?.icon_size, lineHeight: 1 }}>{supportLink?.icon}</span>
  );

  // AttendeeProvider persists across client-side route changes. Refresh on
  // entering Profile so an APN correction is visible on normal navigation,
  // not only after a full reload.
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Log today's attendance once per mount when presence is confirmed —
  // decoupled from how many times the underlying shared query itself runs.
  const attendanceLoggedRef = useRef(false);
  useEffect(() => {
    if (attendeeData?.todayEventPresence && !attendanceLoggedRef.current) {
      attendanceLoggedRef.current = true;
      fetch('/api/attendance/log', { method: 'POST' }).catch(() => {});
    }
  }, [attendeeData]);

  const fullNameFa = attendeeData ? `${attendeeData.firstname_fa || ""} ${attendeeData.lastname_fa || ""}`.trim() : "";
  const enName = attendeeData ? `${attendeeData.firstname_en || ""} ${attendeeData.lastname_en || ""}`.trim() : "";


  return (
    <main
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
      className="min-h-dvh"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="dark-only fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md mx-auto px-4 pb-32">
        <PageHeader title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} leftActions={<GearIcon lang={lang} />} isHomeContext={isHomeContext} showBack={showBack} />

        {/* User card */}
        <div
          className="relative backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
          style={{ background: "var(--surface)" }}
        >
          {/* Edit icon — top-left (RTL) or top-right (LTR) */}
          <button
            onClick={() => router.push("/profile/edit")}
            aria-label={t(lang, "edit_profile")}
            className="absolute transition-all active:scale-90"
            style={{
              top: 16,
              ...(isRTL ? { left: 16 } : { right: 16 }),
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
          </button>

          <div className="flex items-center gap-4 mb-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
              style={{
                background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
              }}
            >
              {attendeeData?.profile?.jpg?.["128"] ? (
                <img
                  src={`${RASAYESH_BASE}${attendeeData.profile.jpg["128"]}`}
                  alt={t(lang, "profile_title")}
                  className="w-16 h-16 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span
                  style={{
                    display: "block",
                    width: 32,
                    height: 32,
                    backgroundColor: "var(--text-muted)",
                    maskImage: "url('/logo/user.svg')",
                    maskSize: "contain",
                    maskRepeat: "no-repeat",
                    maskPosition: "center",
                    WebkitMaskImage: "url('/logo/user.svg')",
                    WebkitMaskSize: "contain",
                    WebkitMaskRepeat: "no-repeat",
                    WebkitMaskPosition: "center",
                  }}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {lang === "en" ? (
                <>
                  {enName && (
                    <h2 className="font-bold text-lg leading-7 truncate" style={{ color: "var(--text)" }}>
                      {enName}
                    </h2>
                  )}
                  {fullNameFa && (
                    <p className="text-sm truncate" style={{ color: "var(--text-dim)", direction: "rtl" }}>
                      {fullNameFa}
                    </p>
                  )}
                </>
              ) : (
                <>
                  {fullNameFa && (
                    <h2 className="font-bold text-lg leading-7 truncate" style={{ color: "var(--text)" }}>
                      {fullNameFa}
                    </h2>
                  )}
                  {enName && (
                    <p
                      className="text-sm truncate"
                      style={{ color: "var(--text-dim)", direction: "ltr", textAlign: "left" }}
                    >
                      {enName}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="space-y-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            {lang === "en" && attendeeData?.email && (
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>{t(lang, "profile_email")}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text)", direction: "ltr" }}>
                  {attendeeData.email}
                </span>
              </div>
            )}
            {attendeeData?.mobile && (
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>{t(lang, "profile_mobile")}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text)", direction: "ltr" }}>
                  {normalizePhone(attendeeData.mobile, lang)}
                </span>
              </div>
            )}
            {(lang === "en" ? attendeeData?.job_title_en : attendeeData?.job_title_fa) && (
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>{t(lang, "profile_job")}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  {lang === "en" ? attendeeData.job_title_en : attendeeData.job_title_fa}
                </span>
              </div>
            )}

            {profileLoading ? (
              <>
                <SkeletonBlock className="h-4 w-48" />
                <SkeletonBlock className="h-4 w-40" />
              </>
            ) : (
              <>
                {attendeeData?.national_code && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: "var(--text-dim)" }}>{t(lang, "profile_national_code")}</span>
                    <span
                      className="text-sm font-medium"
                      style={{ color: "var(--text)", direction: "ltr", letterSpacing: "0.05em" }}
                    >
                      {maskNationalCode(attendeeData.national_code, lang)}
                    </span>
                  </div>
                )}
                {lang === "fa" && attendeeData?.email && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: "var(--text-dim)" }}>{t(lang, "profile_email")}</span>
                    <span className="text-sm font-medium" style={{ color: "var(--text)", direction: "ltr" }}>
                      {attendeeData.email}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Profile completion bar */}
        <ProfileCompletionBar lang={lang} />

        {/* Presence card */}
        {profileLoading ? (
          <div
            className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4 mt-5"
            style={{ background: "var(--surface)" }}
          >
            <SkeletonBlock className="h-3 w-32 mb-3" />
            <SkeletonBlock className="h-5 w-48" />
          </div>
        ) : attendeeData ? (
          <div
            className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4 mt-5"
            style={{ background: "var(--surface)" }}
          >
            <p className="text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>
              {t(lang, "profile_presence")}
            </p>
            <p
              className="font-medium text-sm"
              style={{ color: attendeeData.todayEventPresence ? "var(--accent)" : "var(--text)" }}
            >
              {attendeeData.todayEventPresence
                ? t(lang, "profile_present")
                : t(lang, "profile_not_present")}
            </p>
          </div>
        ) : null}

        {/* Contact support -- admin-configured (iph-apn ⚙️ عمومی), inert
            when no link is set (see supportLinkVisible above). Positioned
            directly above the logout button per the product ask. */}
        {supportLinkVisible && (
          <a
            href={supportLink.target_url}
            target={isExternalSupportTarget ? "_blank" : undefined}
            rel={isExternalSupportTarget ? "noopener noreferrer" : undefined}
            className="w-full mb-3 active:scale-95 transition-transform"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: "var(--btn-secondary-bg)",
              color: "var(--btn-secondary-text)",
              border: "1px solid var(--btn-secondary-border)",
              borderRadius: 12,
              padding: "10px 20px",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            {supportLinkIconEl}
            <span style={{ fontSize: supportLink.label_size }}>
              {lang === "en" ? (supportLink.label_en || supportLink.label_fa) : supportLink.label_fa}
            </span>
          </a>
        )}

        {/* Logout button */}
        <Button
          onClick={logout}
          variant="danger"
          className="w-full mb-4"
          style={{ fontWeight: 500 }}
        >
          {t(lang, "logout_button")}
        </Button>
      </div>

      <BottomNav />
    </main>
  );
}
