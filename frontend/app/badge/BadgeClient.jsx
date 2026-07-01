"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import RasayeshBadgeCard from "@/components/RasayeshBadgeCard";
import { useAuth } from "../../hooks/useAuth";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

const BADGE_QUERY = gql`
  query GetBadge($uuid: String!, $eventSlug: String!) {
    attendeeEventCard(eventSlug: $eventSlug, uuid: $uuid) {
      status
      message
      data {
        attendee {
          firstname_fa lastname_fa firstname_en lastname_en
          uuid job_title_fa mobile
        }
        registrationPlan { id }
        event { id slug }
      }
    }
  }
`;

function SkeletonBlock({ className }) {
  return (
    <div
      className={`animate-pulse rounded-2xl ${className}`}
      style={{ background: "rgba(255,255,255,0.05)" }}
    />
  );
}

function QRCode({ uuid }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!uuid || !containerRef.current) return;
    const container = containerRef.current;
    container.innerHTML = "";

    import("@zxing/browser")
      .then(({ BrowserQRCodeSvgWriter }) => {
        if (!container) return;
        const writer = new BrowserQRCodeSvgWriter();
        const svg = writer.write(uuid, 180, 180);
        container.appendChild(svg);
      })
      .catch(() => {
        if (!container) return;
        container.innerHTML =
          '<div style="width:180px;height:180px;display:flex;align-items:center;justify-content:center;font-size:11px;color:rgba(0,0,0,0.4)">QR</div>';
      });
  }, [uuid]);

  return (
    <div
      ref={containerRef}
      className="rounded-2xl overflow-hidden mx-auto"
      style={{
        background: "#ffffff",
        width: 180,
        height: 180,
        flexShrink: 0,
      }}
    />
  );
}

function BadgeIcon({ settings, maxSize }) {
  const rawSize = Math.min(200, Math.max(32, Number(settings.logo_icon_size) || 64));
  const size = maxSize ? Math.min(rawSize, maxSize) : rawSize;
  if (settings.logo_icon_type === 'emoji') {
    return (
      <span style={{ fontSize: Math.min(size, 32), lineHeight: 1 }}>
        {settings.logo_icon_value || '💊'}
      </span>
    );
  }
  if (settings.logo_icon_value) {
    return (
      <img
        src={settings.logo_icon_value}
        alt=""
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    );
  }
  return <span style={{ fontSize: 28, lineHeight: 1 }}>💊</span>;
}

async function downloadCard() {
  const el = document.getElementById("rasayesh-badge-card");
  if (!el) return;
  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(el, { scale: 3, useCORS: true, allowTaint: false });
    const link = document.createElement("a");
    link.download = "badge.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (err) {
    console.error("[download badge]", err);
  }
}

export default function BadgeClient({ title, subtitle, title_en, subtitle_en, badgeSettings = {} }) {
  const { isLoggedIn } = useAuth();
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [badgeData, setBadgeData] = useState(null);
  const [badgeStatus, setBadgeStatus] = useState(null);
  const [cardTemplate, setCardTemplate] = useState(null);
  const { isRTL, lang } = useLang();

  const settings = {
    logo_icon_type: 'image',
    logo_icon_value: '/logo/logo-l.png',
    logo_icon_size: 64,
    show_qr: true,
    show_company: true,
    show_job_title: true,
    show_national_id: false,
    event_name_fa: 'نمایشگاه ایران‌فارما',
    event_name_en: 'IranPharma Exhibition',
    ...badgeSettings,
  };

  const displayEventName = lang === 'en'
    ? (settings.event_name_en || settings.event_name_fa)
    : settings.event_name_fa;

  useEffect(() => {
    queueMicrotask(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!authReady) return;

    if (!isLoggedIn) {
      queueMicrotask(() => setLoading(false));
      return;
    }

    const { user } = (() => {
      try {
        const m = document.cookie.match(/(?:^|; )iph_user=([^;]*)/);
        const u = m ? JSON.parse(decodeURIComponent(m[1])) : null;
        return { user: u };
      } catch { return { user: null }; }
    })();

    const uuid = user?.uuid;

    Promise.all([
      fetch("/api/badge").then((r) => r.json()),
      fetch("/api/badge/template").then((r) => r.json()).catch(() => ({ template: null })),
    ])
      .then(([configRes, tmplRes]) => {
        const eventSlug = configRes.event_slug || 'iph';
        if (tmplRes.template) setCardTemplate(tmplRes.template);

        if (!uuid) {
          setBadgeStatus("fail");
          return;
        }

        const client = getApolloClient();
        return client.query({
          query: BADGE_QUERY,
          variables: { uuid, eventSlug },
        }).then(({ data }) => {
          const card = data?.attendeeEventCard;
          setBadgeStatus(card?.status ?? null);
          if (card?.status === "success") setBadgeData(card.data ?? null);
        });
      })
      .catch(() => setBadgeStatus("fail"))
      .finally(() => setLoading(false));
  }, [authReady, isLoggedIn]);

  const attendee = badgeData?.attendee;
  const registrationPlan = badgeData?.registrationPlan;
  const nameFa = [attendee?.firstname_fa, attendee?.lastname_fa].filter(Boolean).join(" ");
  const nameEn = [attendee?.firstname_en, attendee?.lastname_en].filter(Boolean).join(" ");

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
        <PageHeader title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />

        {loading && (
          <div
            className="backdrop-blur-xl border border-[#00ffb3]/20 rounded-3xl overflow-hidden"
            style={{ background: "var(--surface)" }}
          >
            <div
              className="px-6 py-4"
              style={{ background: "linear-gradient(135deg, rgba(0,255,179,0.1), rgba(0,255,179,0.03))" }}
            >
              <SkeletonBlock className="h-5 w-48 mb-1" />
              <SkeletonBlock className="h-3 w-32" />
            </div>
            <div className="px-6 py-5 flex flex-col items-center gap-4">
              <SkeletonBlock className="h-7 w-52" />
              <SkeletonBlock className="h-5 w-40" />
              <SkeletonBlock className="h-6 w-24 rounded-lg" />
              <div className="rounded-2xl" style={{ background: "rgba(255,255,255,0.05)", width: 180, height: 180 }} />
              <SkeletonBlock className="h-3 w-44" />
            </div>
          </div>
        )}

        {!loading && !isLoggedIn && (
          <div
            className="backdrop-blur-xl border border-[#00ffb3]/20 rounded-3xl p-8 flex flex-col items-center gap-4 text-center"
            style={{ background: "var(--surface)" }}
          >
            <div className="w-20 h-20 rounded-full bg-[#00ffb3]/10 border border-[#00ffb3]/20 flex items-center justify-center overflow-hidden">
              <BadgeIcon settings={settings} maxSize={72} />
            </div>
            <p className="font-medium leading-7" style={{ color: "var(--text)" }}>
              {t(lang, "badge_login_prompt")}
            </p>
            <Link
              href="/login"
              className="px-6 py-2.5 rounded-xl font-bold text-sm"
              style={{ background: "var(--accent)", color: "#021f20" }}
            >
              {t(lang, "badge_login_button")}
            </Link>
          </div>
        )}

        {!loading && isLoggedIn && badgeStatus === "success" && attendee && (
          <>
            {/* Rasayesh template card */}
            {cardTemplate ? (
              <div>
                <RasayeshBadgeCard
                  template={cardTemplate}
                  attendee={attendee}
                  eventName={displayEventName}
                />
                <button
                  onClick={downloadCard}
                  className="w-full mt-3 py-2.5 rounded-xl font-bold text-sm"
                  style={{ background: "var(--accent)", color: "#021f20" }}
                >
                  {isRTL ? "دانلود کارت" : "Download Card"}
                </button>
              </div>
            ) : (
              /* Fallback glass card */
              <div
                className="backdrop-blur-xl border-2 border-[#00ffb3]/40 rounded-3xl overflow-hidden"
                style={{ background: "var(--surface)" }}
              >
                {/* Card header with event name and logo */}
                <div
                  className="px-5 py-4 flex items-center justify-between"
                  style={{
                    background: "linear-gradient(135deg, rgba(0,255,179,0.15), rgba(0,255,179,0.04))",
                    borderBottom: "1px solid rgba(0,255,179,0.15)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#00ffb3]/20 border border-[#00ffb3]/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      <BadgeIcon settings={settings} maxSize={30} />
                    </div>
                    <div>
                      <p className="font-black text-sm leading-5" style={{ color: "#00ffb3" }}>
                        {displayEventName}
                      </p>
                      <p className="text-xs leading-5" style={{ color: "var(--text-dim)" }}>
                        {t(lang, "badge_visitor_type")}
                      </p>
                    </div>
                  </div>
                  <div
                    className="px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wider"
                    style={{ background: "rgba(0,255,179,0.15)", color: "#00ffb3" }}
                  >
                    VISITOR
                  </div>
                </div>

                {/* Attendee info */}
                <div className="px-5 pt-5 pb-4 text-center">
                  {nameFa && (
                    <h2 className="font-black text-2xl leading-9" style={{ color: "var(--text)" }}>
                      {nameFa}
                    </h2>
                  )}
                  {nameEn && (
                    <p
                      className="text-sm leading-6 mt-0.5"
                      style={{ color: "var(--text-dim)", direction: "ltr" }}
                    >
                      {nameEn}
                    </p>
                  )}
                  {settings.show_company && attendee.company_name_fa && (
                    <div className="mt-2 inline-flex">
                      <span
                        className="px-3 py-1 rounded-lg text-xs font-medium"
                        style={{ background: "rgba(0,255,179,0.06)", color: "var(--text-dim)" }}
                      >
                        {lang === "en" && attendee.company_name_en
                          ? attendee.company_name_en
                          : attendee.company_name_fa}
                      </span>
                    </div>
                  )}
                  {settings.show_job_title && attendee.job_title_fa && (
                    <div className="mt-2 inline-flex">
                      <span
                        className="px-3 py-1 rounded-lg text-xs font-medium"
                        style={{ background: "rgba(0,255,179,0.1)", color: "#00ffb3" }}
                      >
                        {attendee.job_title_fa}
                      </span>
                    </div>
                  )}
                  {settings.show_national_id && attendee.national_id && (
                    <p className="mt-2 text-xs font-mono" style={{ color: "var(--text-dim)" }}>
                      {attendee.national_id}
                    </p>
                  )}
                </div>

                {/* QR code */}
                {settings.show_qr && (
                  <div className="px-5 pb-4 flex flex-col items-center gap-2">
                    <div className="p-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <QRCode uuid={attendee.uuid} />
                    </div>
                    <p
                      className="text-[10px] font-mono text-center max-w-[200px] truncate"
                      style={{ color: "var(--text-faint)" }}
                    >
                      {attendee.uuid}
                    </p>
                  </div>
                )}

                {registrationPlan?.id && (
                  <div
                    className="px-5 py-3 flex items-center justify-between"
                    style={{ borderTop: "1px solid rgba(0,255,179,0.1)" }}
                  >
                    <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                      {t(lang, "badge_reg_plan")}
                    </p>
                    <p className="text-xs font-medium" style={{ color: "var(--text)" }}>
                      #{registrationPlan.id}
                    </p>
                  </div>
                )}
                {!registrationPlan?.id && (
                  <div
                    className="px-5 py-3"
                    style={{ borderTop: "1px solid rgba(0,255,179,0.1)" }}
                  >
                    <p className="text-xs text-center" style={{ color: "var(--text-faint)" }}>
                      IranPharma 2025 · iphexpo.com
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {!loading && isLoggedIn && badgeStatus !== "success" && (
          <div
            className="backdrop-blur-xl border border-[#00ffb3]/20 rounded-3xl p-8 flex flex-col items-center gap-4 text-center"
            style={{ background: "var(--surface)" }}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
              <BadgeIcon settings={settings} />
            </div>
            <div>
              <h2 className="font-bold text-base leading-7 mb-2" style={{ color: "var(--text)" }}>
                {t(lang, "badge_not_issued")}
              </h2>
              <p className="text-sm leading-7 max-w-xs" style={{ color: "var(--text-dim)" }}>
                {t(lang, "badge_not_issued_desc")}
              </p>
            </div>
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
