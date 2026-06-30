"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import BottomNav from "./BottomNav";
import AppHeader from "./AppHeader";
import Toast from "@/components/Toast";
import { isPushSupported, isIOS, isStandalone, requestNotificationPermission, subscribeToPush } from "@/lib/pushClient";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

function isExternal(link) {
  return /^https?:\/\//.test(link);
}

function PushBanner({ pushPrompt, lang }) {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | done | denied
  const ios = typeof window !== 'undefined' && isIOS();
  const standalone = typeof window !== 'undefined' && isStandalone();

  const prompt = pushPrompt ?? {
    enabled: true,
    icon_type: 'emoji',
    icon_value: '🔔',
    title: 'فعال‌سازی اعلان‌ها',
    description: 'با فعال‌سازی، اطلاعیه‌های مهم نمایشگاه را حتی در پس‌زمینه دریافت کنید.',
    confirm_button: 'فعال‌سازی',
    dismiss_button: 'بعداً',
  };

  useEffect(() => {
    if (!prompt.enabled) return;
    if (!isPushSupported()) return;
    if (localStorage.getItem('push_banner_dismissed')) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') return;
    setVisible(true);
  }, [prompt.enabled]);

  async function handleEnable() {
    setStatus('loading');
    const perm = await requestNotificationPermission();
    if (perm !== 'granted') {
      setStatus('denied');
      return;
    }
    const result = await subscribeToPush();
    setStatus(result.ok ? 'done' : 'denied');
    if (result.ok) {
      localStorage.setItem('push_banner_dismissed', '1');
      setTimeout(() => setVisible(false), 1800);
    }
  }

  function handleDismiss() {
    localStorage.setItem('push_banner_dismissed', '1');
    setVisible(false);
  }

  if (!visible) return null;

  const iconSz = prompt.icon_size ?? 32;
  const icon = prompt.icon_type === 'image' && prompt.icon_value
    ? <img src={prompt.icon_value} alt="" style={{ width: iconSz, height: iconSz, objectFit: 'contain' }} className="flex-shrink-0 mt-0.5" />
    : <span style={{ fontSize: iconSz, lineHeight: 1 }} className="flex-shrink-0 mt-0.5">{prompt.icon_value || '🔔'}</span>;

  return (
    <div
      className="rounded-2xl p-4 mb-4 flex items-start gap-3"
      style={{
        background: "color-mix(in srgb, var(--accent) 8%, var(--surface))",
        border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
      }}
    >
      {icon}
      <div className="flex-1 min-w-0">
        {status === 'done' ? (
          <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
            {t(lang, 'push_done')}
          </p>
        ) : status === 'denied' ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t(lang, 'push_denied')}
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }}>
              {prompt.title}
            </p>
            {prompt.description && (
              <p className="text-xs leading-relaxed mb-2.5" style={{ color: "var(--text-muted)" }}>
                {prompt.description}
              </p>
            )}
            {ios && !standalone && (
              <p className="text-xs mb-2.5 leading-relaxed" style={{ color: "color-mix(in srgb, var(--accent) 80%, var(--text-muted))" }}>
                {t(lang, 'push_ios_hint')}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleEnable}
                disabled={status === 'loading'}
                className="text-xs font-bold rounded-xl px-4 py-1.5"
                style={{
                  background: "var(--accent)",
                  color: "var(--bg)",
                  opacity: status === 'loading' ? 0.7 : 1,
                }}
              >
                {status === 'loading' ? '...' : prompt.confirm_button}
              </button>
              <button
                onClick={handleDismiss}
                className="text-xs rounded-xl px-4 py-1.5"
                style={{
                  border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
                  color: "var(--text-muted)",
                }}
              >
                {prompt.dismiss_button}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ServiceItem({ icon_type, icon_value, title, title_en, link, link_en, is_enabled, is_enabled_en, icon_size, lang }) {
  const displayTitle = (lang === 'en' && title_en) ? title_en : title;
  const displayLink = (lang === 'en' && link_en) ? link_en : link;
  const displayEnabled = (lang === 'en' && is_enabled_en != null) ? is_enabled_en : is_enabled;
  const size = icon_size ?? 48;
  const iconBox = (
    <div
      className="w-14 h-14 rounded-2xl flex items-center justify-center relative"
      style={{
        background: "color-mix(in srgb, var(--accent) 12%, transparent)",
        border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
      }}
    >
      {icon_type === 'image' ? (
        <img
          src={icon_value}
          alt={title}
          style={{ width: size, height: size, objectFit: 'contain', maxWidth: '100%', maxHeight: '100%' }}
        />
      ) : (
        <span style={{ fontSize: `${Math.round(size * 0.6)}px`, lineHeight: 1 }}>{icon_value}</span>
      )}
      {!displayEnabled && (
        <span
          className="absolute -top-2 -right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none"
          style={{
            background: "color-mix(in srgb, var(--accent) 18%, transparent)",
            color: "var(--accent)",
            border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
          }}
        >
          {t(lang, 'coming_soon')}
        </span>
      )}
    </div>
  );

  const inner = (
    <>
      {iconBox}
      <span
        className="text-xs text-center leading-tight mt-2"
        style={{ color: "var(--text-muted)" }}
      >
        {displayTitle}
      </span>
    </>
  );

  if (!displayEnabled) {
    return (
      <div
        className="flex flex-col items-center cursor-default"
        style={{ opacity: 0.5, filter: "grayscale(1)" }}
      >
        {inner}
      </div>
    );
  }

  if (isExternal(displayLink)) {
    return (
      <a
        href={displayLink}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col items-center active:scale-95 transition-transform duration-150"
      >
        {inner}
      </a>
    );
  }

  if (!displayLink || displayLink === '#') {
    return <div className="flex flex-col items-center">{inner}</div>;
  }

  return (
    <Link
      href={displayLink}
      className="flex flex-col items-center active:scale-95 transition-transform duration-150"
    >
      {inner}
    </Link>
  );
}

export default function HomeClient({ services, banners = [], defaultNotifications = [], welcomeToast, pushPrompt }) {
  const { lang, isRTL } = useLang();

  const visibleBanners = useMemo(() =>
    banners
      .filter((b) => lang === 'en' ? (b.is_active_en ?? b.is_active) : b.is_active)
      .map((b) => ({ ...b, link: (lang === 'en' && b.link_en) ? b.link_en : b.link })),
    [banners, lang]
  );

  const [current, setCurrent] = useState(0);
  const [isPressed, setIsPressed] = useState(false);
  const touchStartX = useRef(null);
  const intervalRef = useRef(null);

  const [toastQueue, setToastQueue] = useState([]);
  const [currentToast, setCurrentToast] = useState(null);

  useEffect(() => {
    const currentLang = localStorage.getItem('iph-lang') || 'fa';
    const queue = [];
    try {
      const raw = sessionStorage.getItem("iph_show_welcome");
      if (raw) {
        const { firstname_fa, lastname_fa, firstname_en, lastname_en } = JSON.parse(raw);
        sessionStorage.removeItem("iph_show_welcome");
        const wt = welcomeToast ?? { enabled: true, template: 'خوش آمدید، {name}!', template_en: 'Welcome, {name}!' };
        if (wt.enabled !== false) {
          let name, template;
          if (currentLang === 'en') {
            name = [firstname_en, lastname_en].filter(Boolean).join(" ") ||
                   [firstname_fa, lastname_fa].filter(Boolean).join(" ");
            template = wt.template_en || 'Welcome, {name}!';
          } else {
            name = [firstname_fa, lastname_fa].filter(Boolean).join(" ");
            template = wt.template || 'خوش آمدید، {name}!';
          }
          const message = name
            ? template.replace('{name}', name)
            : template.replace(/[،,]\s*\{name\}/g, '').replace('{name}', '').trim();
          if (message) queue.push({ message, icon: "👋" });
        }
      }
    } catch {
      // ignore
    }
    for (const n of defaultNotifications) {
      queue.push({ message: n.title, icon: n.icon || "📢" });
    }
    if (queue.length > 0) {
      setCurrentToast(queue[0]);
      setToastQueue(queue.slice(1));
    }
  // All props are stable (server-rendered) — safe to omit from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetInterval = useCallback(() => {
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCurrent((c) => (c + 1) % visibleBanners.length);
    }, 4000);
  }, [visibleBanners.length]);

  useEffect(() => {
    setCurrent(0);
    resetInterval();
    return () => clearInterval(intervalRef.current);
  }, [resetInterval]);

  const handleTouchStart = useCallback((e) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e) => {
      if (touchStartX.current === null) return;
      const diff = touchStartX.current - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) {
        setCurrent((c) =>
          diff > 0
            ? (c + 1) % visibleBanners.length
            : (c - 1 + visibleBanners.length) % visibleBanners.length
        );
        resetInterval();
      }
      touchStartX.current = null;
    },
    [visibleBanners.length, resetInterval]
  );

  return (
    <main
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
      className="min-h-screen pb-28"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      {/* Background glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      {currentToast && (
        <Toast
          message={currentToast.message}
          icon={currentToast.icon}
          onDismiss={() => {
            if (toastQueue.length > 0) {
              setCurrentToast(toastQueue[0]);
              setToastQueue((q) => q.slice(1));
            } else {
              setCurrentToast(null);
            }
          }}
        />
      )}

      <div className="relative max-w-md mx-auto px-4">
        <AppHeader />

        {/* Banner carousel — hidden when no active banners */}
        {visibleBanners.length > 0 && (
          <section className="mb-5">
            <div
              dir="ltr"
              className={`relative overflow-hidden rounded-3xl h-[140px] cursor-pointer transition-transform duration-150 select-none ${
                isPressed ? "scale-[1.02]" : "scale-100"
              }`}
              style={{ border: "1px solid var(--border-accent)" }}
              onPointerDown={() => setIsPressed(true)}
              onPointerUp={() => setIsPressed(false)}
              onPointerLeave={() => setIsPressed(false)}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <div
                className="flex h-full transition-transform duration-500 ease-in-out"
                style={{ transform: `translateX(-${current * 100}%)` }}
              >
                {visibleBanners.map((banner, i) => {
                  const img = (
                    <Image
                      src={banner.image_path}
                      alt="IranPharma Expo"
                      fill
                      className="object-cover"
                      priority={i === 0}
                    />
                  );
                  if (banner.link) {
                    return (
                      <a
                        key={banner.id}
                        href={banner.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-full h-full relative block"
                      >
                        {img}
                      </a>
                    );
                  }
                  return (
                    <div key={banner.id} className="min-w-full h-full relative">
                      {img}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Dot indicators — only show when more than one banner */}
            {visibleBanners.length > 1 && (
              <div className="flex justify-center gap-1.5 mt-2.5">
                {visibleBanners.map((_, i) => (
                  <button
                    key={i}
                    aria-label={`${t(lang, 'slide_label')} ${i + 1}`}
                    onClick={() => {
                      setCurrent(i);
                      resetInterval();
                    }}
                    className="transition-all duration-300"
                    style={{
                      width: i === current ? "20px" : "6px",
                      height: "6px",
                      borderRadius: "3px",
                      background:
                        i === current ? "var(--accent)" : "var(--border)",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        <PushBanner pushPrompt={pushPrompt} lang={lang} />

        {/* Service grid */}
        {services.length > 0 && (() => {
          const visibleServices = services.filter(svc =>
            lang === 'en'
              ? (svc.is_visible_en != null ? svc.is_visible_en : svc.is_visible)
              : svc.is_visible
          );
          if (visibleServices.length === 0) return null;
          return (
            <section>
              <h2
                className="text-sm font-medium mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                {t(lang, 'services_heading')}
              </h2>
              <div
                className="rounded-3xl p-5 backdrop-blur-xl"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="grid grid-cols-4 gap-3">
                  {visibleServices.map((svc) => (
                    <ServiceItem key={svc.id} {...svc} lang={lang} />
                  ))}
                </div>
              </div>
            </section>
          );
        })()}
      </div>

      <BottomNav />
    </main>
  );
}
