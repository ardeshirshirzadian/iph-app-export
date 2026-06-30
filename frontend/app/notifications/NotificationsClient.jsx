"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { toRelativeTime } from "@/lib/utils";
import { useNotificationSocket } from "@/lib/socketClient";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

function isExternal(url) {
  return /^https?:\/\//.test(url);
}

function NotifCard({ notif, lang, isRTL }) {
  const inner = (
    <div
      className="rounded-2xl p-4 flex gap-3 items-start transition-all duration-150 active:scale-[0.98]"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      {notif.image_path ? (
        <div
          className="flex-shrink-0 rounded-xl overflow-hidden"
          style={{ width: 56, height: 56, position: "relative" }}
        >
          <Image src={notif.image_path} alt={notif.title} fill className="object-cover" />
        </div>
      ) : (
        <div
          className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center"
          style={{
            background: "color-mix(in srgb, var(--accent) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
            fontSize: notif.icon_size ?? 32,
          }}
        >
          {notif.icon || "📢"}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-snug" style={{ color: "var(--text)" }}>
          {notif.title}
        </p>
        {notif.description && (
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {notif.description}
          </p>
        )}
        <p
          className="text-[11px] mt-1.5"
          style={{ color: "color-mix(in srgb, var(--accent) 70%, var(--text-faint))" }}
        >
          {toRelativeTime(notif.created_at, lang)}
        </p>
      </div>

      {notif.link && (
        <div
          className="flex-shrink-0 self-center text-lg"
          style={{ color: "var(--text-dim)" }}
        >
          {isRTL ? "←" : "→"}
        </div>
      )}
    </div>
  );

  if (!notif.link) return <div>{inner}</div>;

  if (isExternal(notif.link)) {
    return (
      <a href={notif.link} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }

  return <Link href={notif.link}>{inner}</Link>;
}

export default function NotificationsClient({ title, subtitle, title_en, subtitle_en }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const { lang, isRTL } = useLang();

  const fetchNotifications = useCallback(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then(({ notifications: rows = [] }) => setNotifications(rows))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchNotifications();
    localStorage.setItem("notif_last_seen", String(Date.now()));
  }, [fetchNotifications]);

  const handleLive = useCallback((notif) => {
    setNotifications((prev) => [notif, ...prev]);
  }, []);

  useNotificationSocket(handleLive, fetchNotifications);

  return (
    <main
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
      className="min-h-screen pb-28"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md mx-auto px-4">
        <PageHeader title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />

        {loading ? (
          <div
            className="text-center py-16 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t(lang, "loading")}
          </div>
        ) : notifications.length === 0 ? (
          <div
            className="text-center py-16 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t(lang, "notifications_empty")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {notifications.map((n) => (
              <NotifCard key={n.id} notif={n} lang={lang} isRTL={isRTL} />
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
