"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "../../hooks/useAuth";
import { toPersianDigits } from "@/lib/utils";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

const ATTENDEE_QUERY = gql`
  query GetAttendee($id: Int!) {
    attendee(id: $id) {
      firstname_en
      lastname_en
      national_code
      email
      profile
      todayEventPresence(eventId: 1)
    }
  }
`;

const TRANSACTIONS_QUERY = gql`
  {
    attendeeTransactions {
      id
      total_price
      discounted_price
      discount_price
      price_paid
      status
      success
      verification_status
      uuid
      created_at
      event { id title_fa title_en }
      cart { id cart_items { entity_type entity_id snapshot } }
    }
  }
`;

const PANELS_QUERY = gql`
  {
    attendeePanels {
      id
      panel {
        id title_fa title_en starts_at ends_at hall_fa hall_en
        event { id title_fa title_en }
      }
    }
  }
`;

const IRANPHARMA_EVENT_IDS = new Set([1, 6, 14, 18, 26]);

function parseSnapshot(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function buildDescription(cartItems) {
  if (!cartItems?.length) return { fa: null, en: null };
  const parts_fa = [];
  const parts_en = [];
  for (const item of cartItems) {
    const snap = parseSnapshot(item.snapshot);
    if (item.entity_type === 'EventExhibitionBook') {
      parts_fa.push(`خرید کتاب: ${snap.title_fa || 'کتاب نمایشگاه'}`);
      parts_en.push(`Book: ${snap.title_en || 'Exhibition Book'}`);
    } else if (item.entity_type === 'EventRegistrationPlan') {
      parts_fa.push(`ثبت‌نام: ${snap.title_fa || 'طرح ثبت‌نام'}`);
      parts_en.push(`Registration: ${snap.title_en || 'Registration Plan'}`);
    } else if (item.entity_type === 'EventPanel') {
      parts_fa.push(`ثبت‌نام پنل: ${snap.title_fa || 'پنل'}`);
      parts_en.push(`Panel: ${snap.title_en || 'Panel'}`);
    }
  }
  return { fa: parts_fa.join('، ') || null, en: parts_en.join(', ') || null };
}

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
  if (Number(price) === 0) return lang === "fa" ? "رایگان" : "Free";
  const n = Number(price).toLocaleString("en-US");
  return lang === "fa" ? toPersianDigits(n) + " تومان" : n + " Toman";
}

function formatDateTime(dateStr, lang) {
  if (!dateStr) return "—";
  try {
    if (lang === "fa") {
      return new Date(dateStr).toLocaleString("fa-IR", {
        year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    }
    return new Date(dateStr).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatDate(dateStr, lang) {
  if (!dateStr) return "—";
  try {
    if (lang === "fa") {
      return new Date(dateStr).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
    }
    return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function getTxnBadge(txn, lang) {
  const price = Number(txn.total_price ?? 0);
  if (price === 0) {
    return { label: lang === "fa" ? "رایگان" : "Free", color: "#00ffb3", bg: "rgba(0,255,179,0.1)" };
  }
  if (txn.success === true) {
    return { label: lang === "fa" ? "موفق" : "Successful", color: "#22c55e", bg: "rgba(34,197,94,0.1)" };
  }
  if (txn.status === "NOK") {
    return { label: lang === "fa" ? "ناموفق" : "Failed", color: "#ef4444", bg: "rgba(239,68,68,0.1)" };
  }
  return { label: lang === "fa" ? "نامشخص" : "Unknown", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" };
}

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
  const router = useRouter();
  const [attendeeData, setAttendeeData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const { lang, isRTL } = useLang();

  const [transactions, setTransactions] = useState([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnOpen, setTxnOpen] = useState(true);

  const [panels, setPanels] = useState([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [panelsOpen, setPanelsOpen] = useState(true);

  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!authReady || !user?.id) return;
    const client = getApolloClient();

    setProfileLoading(true);
    client.query({ query: ATTENDEE_QUERY, variables: { id: Number(user.id) } })
      .then(({ data }) => { if (data?.attendee) setAttendeeData(data.attendee); })
      .catch(() => {})
      .finally(() => setProfileLoading(false));

    setTxnLoading(true);
    client.query({ query: TRANSACTIONS_QUERY })
      .then(({ data }) => {
        const raw = data?.attendeeTransactions ?? [];
        const filtered = [...raw]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .filter(t =>
            IRANPHARMA_EVENT_IDS.has(Number(t.event?.id)) &&
            (t.total_price > 0 || t.discount_price > 0)
          )
          .map(t => {
            const desc = buildDescription(t.cart?.cart_items);
            return {
              id: t.id,
              uuid: t.uuid,
              total_price: t.total_price,
              discounted_price: t.discounted_price,
              discount_price: t.discount_price,
              price_paid: t.price_paid,
              status: t.status,
              success: t.success,
              verification_status: t.verification_status,
              created_at: t.created_at,
              event_name: t.event?.title_fa ?? null,
              items_description_fa: desc.fa,
              items_description_en: desc.en,
            };
          });
        setTransactions(filtered);
      })
      .catch(() => {})
      .finally(() => setTxnLoading(false));

    setPanelsLoading(true);
    client.query({ query: PANELS_QUERY })
      .then(({ data }) => {
        const items = data?.attendeePanels ?? [];
        const mapped = items
          .map(item => ({
            ...item.panel,
            isOnline: false,
            event_name: item.panel?.event?.title_fa ?? null,
          }))
          .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
        setPanels(mapped);
      })
      .catch(() => {})
      .finally(() => setPanelsLoading(false));
  }, [authReady, user?.id]);

  const fullNameFa = user ? `${user.firstname_fa || ""} ${user.lastname_fa || ""}`.trim() : "";
  const enName = attendeeData
    ? `${attendeeData.firstname_en || ""} ${attendeeData.lastname_en || ""}`.trim()
    : user
    ? `${user.firstname_en || ""} ${user.lastname_en || ""}`.trim()
    : "";


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
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
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
            {lang === "en" && (attendeeData?.email || user?.email) && (
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>{t(lang, "profile_email")}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text)", direction: "ltr" }}>
                  {attendeeData?.email || user?.email}
                </span>
              </div>
            )}
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

        {/* Panels card */}
        {panelsLoading ? (
          <div
            className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
            style={{ background: "var(--surface)" }}
          >
            <SkeletonBlock className="h-3 w-36 mb-4" />
            <SkeletonBlock className="h-14 w-full mb-2" />
            <SkeletonBlock className="h-14 w-full" />
          </div>
        ) : (
          <div
            className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
            style={{ background: "var(--surface)" }}
          >
            <button
              className="w-full flex justify-between items-center mb-3"
              onClick={() => setPanelsOpen(o => !o)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              <span className="text-xs font-medium" style={{ color: "var(--text-dim)" }}>
                {t(lang, "profile_my_panels")} ({lang === "fa" ? toPersianDigits(String(panels.length)) : panels.length})
              </span>
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{panelsOpen ? "▲" : "▼"}</span>
            </button>
            {panelsOpen && (
              panels.length === 0 ? (
                <p className="text-sm text-center py-2" style={{ color: "var(--text-dim)" }}>
                  {t(lang, "profile_no_panels")}
                </p>
              ) : (
                <div className="space-y-3">
                  {panels.map((w, i) => (
                    <div
                      key={i}
                      className="rounded-2xl p-3"
                      style={{ background: "rgba(255,255,255,0.05)" }}
                    >
                      <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
                        {lang === "en" && w.title_en ? w.title_en : w.title_fa}
                      </p>
                      {w.event_name && (
                        <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>
                          {w.event_name}
                        </p>
                      )}
                      <div className="flex gap-3 flex-wrap items-center">
                        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                          {formatDateTime(w.starts_at, lang)}
                        </span>
                        {(lang === "en" ? w.hall_en : w.hall_fa) && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(0,255,179,0.1)", color: "#00ffb3" }}
                          >
                            {lang === "en" ? w.hall_en : w.hall_fa}
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
              )
            )}
          </div>
        )}

        {/* Transactions card */}
        {txnLoading ? (
          <div
            className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
            style={{ background: "var(--surface)" }}
          >
            <SkeletonBlock className="h-3 w-36 mb-4" />
            <SkeletonBlock className="h-16 w-full mb-2" />
            <SkeletonBlock className="h-16 w-full" />
          </div>
        ) : (
          <div
            className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-5 mb-4"
            style={{ background: "var(--surface)" }}
          >
            <button
              className="w-full flex justify-between items-center mb-3"
              onClick={() => setTxnOpen(o => !o)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              <span className="text-xs font-medium" style={{ color: "var(--text-dim)" }}>
                {t(lang, "profile_transactions")} ({lang === "fa" ? toPersianDigits(String(transactions.length)) : transactions.length})
              </span>
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{txnOpen ? "▲" : "▼"}</span>
            </button>
            {txnOpen && (
              transactions.length === 0 ? (
                <p className="text-sm text-center py-2" style={{ color: "var(--text-dim)" }}>
                  {t(lang, "profile_no_transactions")}
                </p>
              ) : (
                <div className="space-y-3">
                  {transactions.map((txn, i) => {
                    const badge = getTxnBadge(txn, lang);
                    return (
                      <div
                        key={i}
                        className="rounded-2xl p-3"
                        style={{ background: "rgba(255,255,255,0.05)" }}
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                            {formatPrice(txn.total_price, lang)}
                          </span>
                          <span
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: badge.bg, color: badge.color }}
                          >
                            {badge.label}
                          </span>
                        </div>
                        {(lang === "fa" ? txn.items_description_fa : txn.items_description_en) && (
                          <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>
                            {lang === "fa" ? txn.items_description_fa : txn.items_description_en}
                          </p>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                            {formatDate(txn.created_at, lang)}
                          </span>
                          {txn.id && (
                            <span className="text-xs" style={{ color: "var(--text-dim)", direction: "ltr" }}>
                              #{lang === "fa" ? toPersianDigits(String(txn.id)) : txn.id}
                            </span>
                          )}
                        </div>
                        {txn.event_name && (
                          <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                            {txn.event_name}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        )}

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
      </div>

      <BottomNav />
    </main>
  );
}
