"use client";

import { useState, useEffect } from "react";
import PageHeader from "@/components/PageHeader";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import { isPushSupported, requestNotificationPermission, subscribeToPush } from "@/lib/pushClient";

export default function SettingsClient({ title, subtitle, title_en, subtitle_en, themeMode = "system" }) {
  const [isDark, setIsDark] = useState(true);
  const { lang, switchLang, isRTL, langLocked } = useLang();
  const [pushPermission, setPushPermission] = useState('loading');
  // idle | loading | done | permission-denied | subscribe-error --
  // permission-denied and subscribe-error are surfaced as distinct copy
  // below: one means the browser itself blocked the prompt, the other means
  // permission was granted fine but our own subscribe call failed (missing
  // VAPID key, server error, etc) -- telling the user to go check browser
  // settings for the latter would be actively wrong.
  const [pushActionStatus, setPushActionStatus] = useState('idle');
  const [showPushHelp, setShowPushHelp] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setIsDark(localStorage.getItem("iph-theme") !== "light"));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isPushSupported()) {
      setPushPermission('unsupported');
    } else {
      setPushPermission(Notification.permission);
    }
  }, []);

  async function handleEnablePush() {
    setPushActionStatus('loading');
    const perm = await requestNotificationPermission();
    if (perm !== 'granted') {
      setPushPermission(perm);
      setPushActionStatus('permission-denied');
      return;
    }
    setPushPermission('granted');
    const result = await subscribeToPush();
    if (result.ok) {
      setPushActionStatus('done');
      localStorage.setItem('push_banner_dismissed', '1');
      localStorage.removeItem('show_push_popup');
    } else {
      setPushActionStatus('subscribe-error');
    }
  }

  // For the "did you just fix it in browser settings?" case -- re-reads the
  // live value instead of waiting for another full requestPermission() round
  // trip (which browsers won't even show a prompt for once denied anyway).
  function handleCheckPushAgain() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    setPushPermission(Notification.permission);
    if (Notification.permission !== 'denied') setPushActionStatus('idle');
  }

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
      <div className="dark-only fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md mx-auto px-4 pb-16">
        <PageHeader title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />

        <div className="flex flex-col gap-3">
          {/* Appearance section — hidden when admin forces a theme */}
          {themeMode === "system" && (
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
          )}

          {/* Language section -- hidden entirely when single_language is
              forced on (event-wide app-settings toggle): a heading with no
              functional buttons under it would look broken, not just muted. */}
          {!langLocked && (
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
                    color: lang === "fa" ? "var(--btn-primary-text)" : "var(--text-dim)",
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
                    color: lang === "en" ? "var(--btn-primary-text)" : "var(--text-dim)",
                    border: lang === "en" ? "none" : "1px solid var(--border)",
                  }}
                >
                  {t(lang, "lang_en")}
                </button>
              </div>
            </div>
          )}

          {/* Push notifications section */}
          {pushPermission !== 'unsupported' && pushPermission !== 'loading' && (
            <div
              className="backdrop-blur-xl border border-[var(--border)] rounded-3xl p-5"
              style={{ background: "var(--surface)" }}
            >
              <p className="text-xs font-medium mb-4" style={{ color: "var(--text-dim)" }}>
                {t(lang, "settings_notifications")}
              </p>

              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm leading-7" style={{ color: "var(--text)" }}>
                    {t(lang, "push_notifications_label")}
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: (pushPermission === 'granted' && pushActionStatus !== 'subscribe-error') ? "var(--accent)" : "var(--text-dim)" }}>
                    {pushPermission === 'granted' && pushActionStatus !== 'subscribe-error'
                      ? t(lang, 'push_done')
                      : pushPermission === 'denied'
                      ? t(lang, 'push_denied')
                      : pushActionStatus === 'subscribe-error'
                      ? t(lang, 'push_subscribe_error')
                      : ''}
                  </p>
                </div>

                {(pushPermission === 'default' || pushActionStatus === 'subscribe-error') && pushActionStatus !== 'done' && (
                  <button
                    onClick={handleEnablePush}
                    disabled={pushActionStatus === 'loading'}
                    className="flex-shrink-0 text-xs font-bold rounded-xl px-4 py-2 transition-opacity"
                    style={{
                      background: "var(--accent)",
                      color: "var(--bg)",
                      opacity: pushActionStatus === 'loading' ? 0.6 : 1,
                    }}
                  >
                    {pushActionStatus === 'loading' ? '...' : t(lang, 'push_enable_btn')}
                  </button>
                )}

                {((pushPermission === 'granted' && pushActionStatus !== 'subscribe-error') || pushActionStatus === 'done') && (
                  <span className="flex-shrink-0 text-lg" style={{ color: "var(--accent)" }}>✓</span>
                )}
              </div>

              {pushPermission === 'denied' && (
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleCheckPushAgain}
                      className="text-xs font-bold rounded-xl px-3 py-1.5 transition-opacity"
                      style={{ background: "var(--surface-2)", color: "var(--text)" }}
                    >
                      {t(lang, 'push_check_again')}
                    </button>
                    <button
                      onClick={() => setShowPushHelp((v) => !v)}
                      className="text-xs font-medium"
                      style={{ color: "var(--accent)" }}
                    >
                      {t(lang, 'push_how_label')} {showPushHelp ? '▲' : '▼'}
                    </button>
                  </div>

                  {showPushHelp && (
                    <div className="mt-3 flex flex-col gap-2">
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                        {t(lang, 'push_guide_chrome')}
                      </p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                        {t(lang, 'push_guide_safari_mac')}
                      </p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                        {t(lang, 'push_guide_safari_ios')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
