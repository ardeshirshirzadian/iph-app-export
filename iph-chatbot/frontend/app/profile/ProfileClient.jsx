"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "../../hooks/useAuth";
import { toPersianDigits } from "@/lib/utils";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

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

function formatPrice(price, lang) {
  if (price == null) return "—";
  if (lang === "fa") {
    return Number(price).toLocaleString("fa-IR") + " تومان";
  }
  return Number(price).toLocaleString("en-US") + " Toman";
}

function formatDate(dateStr, lang) {
  if (!dateStr) return "—";
  try {
    if (lang === "fa") {
      return new Date(dateStr).toLocaleDateString("fa-IR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

const STATUS_KEYS = {
  paid: "status_paid",
  pending: "status_pending",
  failed: "status_failed",
  success: "status_success",
  cancelled: "status_cancelled",
};

function SkeletonBlock({ className }) {
  return (
    <div
      className={`animate-pulse rounded-2xl ${className}`}
      style={{ background: "rgba(255,255,255,0.05)" }}
    />
  );
}

function GearIcon({ lang }) {
  return (
    <Link
      href="/settings"
      aria-label={t(lang, "settings_aria")}
      className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform active:scale-90 duration-150"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.01 7.01 0 0 0-1.62-.94l-.36-2.54A.484.484 0 0 0 14 2h-3.84a.47.47 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.47a.472.472 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
      </svg>
    </Link>
  );
}

export default function ProfileClient({ title, subtitle, title_en, subtitle_en }) {
  const { user, logout } = useAuth();
  const [attendeeData, setAttendeeData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const { lang, isRTL } = useLang();

  useEffect(() => {
    setProfileLoading(true);
    fetch("/api/profile")
      .then((r) => {
        if (r.status === 401) return null;
        return r.json();
      })
      .then((data) => {
        if (data?.attendee) setAttendeeData(data.attendee);
      })
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, []);

  const fullNameFa = user ? `${user.firstname_fa || ""} ${user.lastname_fa || ""}`.trim() : "";

  const enName = attendeeData
    ? `${attendeeData.firstname_en || ""} ${attendeeData.lastname_en || ""}`.trim()
    : user
    ? `${user.firstname_en || ""} ${user.lastname_en || ""}`.trim()
    : "";

  const workshops = attendeeData
    ? [
        ...(attendeeData.eventPanels || []).map((p) => ({ ...p, isOnline: false })),
        ...(attendeeData.eventOnlineWorkshops || []).map((w) => ({ ...w, isOnline: true })),
      ]
    : [];

  const transactions = attendeeData?.eventTransactions || [];

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

      <div className="relative max-w-md mx-auto px-4 pb-32">
        <PageHeader title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} leftActions={<GearIcon lang={lang} />} />

        <>
          {/* User card */}
          <div
            className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
            style={{ background: "var(--surface)" }}
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-full bg-[#00ffb3]/10 border border-[#00ffb3]/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {attendeeData?.profile ? (
                  <img
                    src={attendeeData.profile}
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
              <div>
                {fullNameFa && (
                  <h2 className="font-bold text-lg leading-7" style={{ color: "var(--text)" }}>
                    {fullNameFa}
                  </h2>
                )}
                {enName && (
                  <p
                    className="text-sm"
                    style={{ color: "var(--text-dim)", direction: "ltr", textAlign: "left" }}
                  >
                    {enName}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              {user?.mobile && (
                <div className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: "var(--text-dim)" }}>{t(lang, "profile_mobile")}</span>
                  <span className="text-sm font-medium" style={{ color: "var(--text)", direction: "ltr" }}>
                    {normalizePhone(user.mobile, lang)}
                  </span>
                </div>
              )}
              {user?.job_title_fa && (
                <div className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: "var(--text-dim)" }}>{t(lang, "profile_job")}</span>
                  <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                    {user.job_title_fa}
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
                  {attendeeData?.email && (
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

          {/* Presence card */}
          {profileLoading ? (
            <div
              className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
              style={{ background: "var(--surface)" }}
            >
              <SkeletonBlock className="h-3 w-32 mb-3" />
              <SkeletonBlock className="h-5 w-48" />
            </div>
          ) : attendeeData ? (
            <div
              className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
              style={{ background: "var(--surface)" }}
            >
              <p className="text-xs font-medium mb-2" style={{ color: "var(--text-dim)" }}>
                {t(lang, "profile_presence")}
              </p>
              <p
                className="font-medium text-sm"
                style={{ color: attendeeData.todayEventPresence ? "#00ffb3" : "var(--text)" }}
              >
                {attendeeData.todayEventPresence
                  ? t(lang, "profile_present")
                  : t(lang, "profile_not_present")}
              </p>
            </div>
          ) : null}

          {/* Workshops card */}
          {profileLoading ? (
            <div
              className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
              style={{ background: "var(--surface)" }}
            >
              <SkeletonBlock className="h-3 w-36 mb-4" />
              <SkeletonBlock className="h-14 w-full mb-2" />
              <SkeletonBlock className="h-14 w-full" />
            </div>
          ) : attendeeData ? (
            <div
              className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
              style={{ background: "var(--surface)" }}
            >
              <p className="text-xs font-medium mb-3" style={{ color: "var(--text-dim)" }}>
                {t(lang, "profile_workshops")}
              </p>
              {workshops.length === 0 ? (
                <p className="text-sm text-center py-2" style={{ color: "var(--text-dim)" }}>
                  {t(lang, "profile_no_workshops")}
                </p>
              ) : (
                <div className="space-y-3">
                  {workshops.map((w, i) => (
                    <div
                      key={i}
                      className="rounded-2xl p-3"
                      style={{ background: "rgba(255,255,255,0.05)" }}
                    >
                      <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
                        {w.title_fa}
                      </p>
                      <div className="flex gap-3 flex-wrap items-center">
                        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                          {formatDate(w.starts_at, lang)}
                        </span>
                        {w.hall_fa && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(0,255,179,0.1)", color: "#00ffb3" }}
                          >
                            {w.hall_fa}
                          </span>
                        )}
                        {w.isOnline && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(0,255,179,0.1)", color: "#00ffb3" }}
                          >
                            {t(lang, "profile_online")}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Transactions card */}
          {profileLoading ? (
            <div
              className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
              style={{ background: "var(--surface)" }}
            >
              <SkeletonBlock className="h-3 w-36 mb-4" />
              <SkeletonBlock className="h-16 w-full mb-2" />
              <SkeletonBlock className="h-16 w-full" />
            </div>
          ) : attendeeData ? (
            <div
              className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
              style={{ background: "var(--surface)" }}
            >
              <p className="text-xs font-medium mb-3" style={{ color: "var(--text-dim)" }}>
                {t(lang, "profile_transactions")}
              </p>
              {transactions.length === 0 ? (
                <p className="text-sm text-center py-2" style={{ color: "var(--text-dim)" }}>
                  {t(lang, "profile_no_transactions")}
                </p>
              ) : (
                <div className="space-y-3">
                  {transactions.map((txn, i) => (
                    <div
                      key={i}
                      className="rounded-2xl p-3"
                      style={{ background: "rgba(255,255,255,0.05)" }}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background:
                              txn.status === "paid" || txn.status === "success"
                                ? "rgba(0,255,179,0.1)"
                                : "rgba(255,107,107,0.1)",
                            color:
                              txn.status === "paid" || txn.status === "success"
                                ? "#00ffb3"
                                : "#ff6b6b",
                          }}
                        >
                          {t(lang, STATUS_KEYS[txn.status] || txn.status)}
                        </span>
                        <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                          {formatPrice(txn.total_price, lang)}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                        {formatDate(txn.created_at, lang)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Logout button */}
          <button
            onClick={logout}
            className="w-full mb-4 py-2.5 rounded-xl text-sm font-medium border transition-colors"
            style={{
              color: "#ff6b6b",
              borderColor: "rgba(255,107,107,0.2)",
              background: "rgba(255,107,107,0.05)",
            }}
          >
            {t(lang, "logout_button")}
          </button>
        </>
      </div>

      <BottomNav />
    </main>
  );
}
