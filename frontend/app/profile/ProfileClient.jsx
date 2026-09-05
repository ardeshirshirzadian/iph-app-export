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

export default function ProfileClient({ title, subtitle, title_en, subtitle_en, isHomeContext = false, showBack = true }) {
  const { logout } = useAuth();
  const router = useRouter();
  const { attendee: attendeeData, loading: profileLoading } = useAttendee();
  const { lang, isRTL } = useLang();

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

        {/* Mandatory photo banner — shown when attendee data is loaded and no photo exists */}
        {attendeeData && !attendeeData.profile?.jpg?.["128"] && (
          <div
            className="mb-4 rounded-2xl p-4 flex items-start gap-3"
            style={{ background: "rgba(255,179,0,0.1)", border: "1px solid rgba(255,179,0,0.35)" }}
          >
            <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>📸</span>
            <div className="flex-1 min-w-0">
              {lang === "en" ? (
                <>
                  <p className="text-sm font-bold mb-1" style={{ color: "#ffb300" }}>Profile photo required</p>
                  <p className="text-xs leading-5" style={{ color: "var(--text-muted)" }}>
                    You must upload a profile photo to access the app. Please tap the button below to add your photo.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold mb-1" style={{ color: "#ffb300" }}>تصویر پروفایل الزامی است</p>
                  <p className="text-xs leading-6" style={{ color: "var(--text-muted)" }}>
                    برای استفاده از اپلیکیشن باید تصویر پروفایل خود را آپلود کنید. لطفاً روی دکمه زیر ضربه بزنید.
                  </p>
                </>
              )}
              <Link
                href="/profile/edit"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl transition-all active:scale-95"
                style={{ background: "#ffb300", color: "#021f20", textDecoration: "none" }}
              >
                {lang === "en" ? "Upload Photo" : "آپلود تصویر"}
              </Link>
            </div>
          </div>
        )}

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
