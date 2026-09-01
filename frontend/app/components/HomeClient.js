"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import BottomNav from "./BottomNav";
import PageHeader from "@/components/PageHeader";
import Toast from "@/components/Toast";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import { hapticLight } from "@/lib/haptics";
import { fetchPublicGraphQL } from "@/lib/publicRasayeshClient";
import ProfileCompletionBar from "./ProfileCompletionBar";

const LATEST_NEWS_QUERY = `
  query EventLatestBlogPosts($mainEventId: Int, $count: Int) {
    eventLatestBlogPosts(mainEventId: $mainEventId, count: $count) {
      id
      title
      excerpt
      thumbnail
      slug
      created_at
    }
  }
`;

const RASAYESH_BASE = "https://api.rasayesh.com/";

function thumbUrl(thumbnail, size) {
  if (!thumbnail) return null;
  const fmt = thumbnail.jpg || thumbnail.png || thumbnail.webp;
  if (!fmt) return null;
  return RASAYESH_BASE + (fmt[size] || fmt["256"] || fmt["128"] || Object.values(fmt)[0]);
}

function NewsStrip({ lang }) {
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    fetchPublicGraphQL(
      LATEST_NEWS_QUERY,
      { mainEventId: 1, count: 5 },
      'https://2025.iphexpo.com'
    )
      .then((result) => {
        const items = result?.data?.eventLatestBlogPosts ?? [];
        if (items.length) setPosts(items);
      })
      .catch(() => {});
  }, []);

  if (posts.length === 0) return null;

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
          {t(lang, "news_latest")}
        </span>
        <Link href="/news" className="text-xs" style={{ color: "var(--accent)" }}>
          {t(lang, "news_all")}
        </Link>
      </div>
      <div
        className="flex gap-3 overflow-x-auto pb-2"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {posts.map((post) => {
          const img = thumbUrl(post.thumbnail, "256");
          const date = post.created_at
            ? new Date(post.created_at).toLocaleDateString(
                lang === "fa" ? "fa-IR-u-ca-persian" : "en-US",
                { month: "short", day: "numeric" }
              )
            : "";
          return (
            <Link
              key={post.id}
              href={`/news/${post.slug}`}
              className="flex-shrink-0 rounded-2xl overflow-hidden active:scale-95 transition-transform duration-150"
              style={{
                width: 180,
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              {img ? (
                <div style={{ width: "100%", height: 120, overflow: "hidden", flexShrink: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img}
                    alt={post.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
              ) : (
                <div style={{ width: "100%", height: 120, background: "var(--surface-alt)", flexShrink: 0 }} />
              )}
              <div className="p-2">
                <p
                  className="text-xs font-medium leading-snug"
                  style={{
                    color: "var(--text)",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {post.title}
                </p>
                <p className="text-[10px] mt-1" style={{ color: "var(--text-dim)" }}>
                  {date}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function isExternal(link) {
  return /^https?:\/\//.test(link);
}

function ServiceItem({ icon_type, icon_value, title, title_en, link, link_en, is_enabled, is_enabled_en, icon_size, lang }) {
  const displayTitle = (lang === 'en' && title_en) ? title_en : title;
  const displayLink = (lang === 'en' && link_en) ? link_en : link;
  const displayEnabled = (lang === 'en' && is_enabled_en != null) ? is_enabled_en : is_enabled;
  const size = icon_size ?? 48;
  const iconBox = (
    <div
      className="w-16 h-16 rounded-[16px] flex items-center justify-center relative"
      style={{
        background: "var(--surface-alt)",
        border: "1px solid color-mix(in srgb, rgb(from var(--surface-alt) r g b) 25%, transparent)",
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
        onClick={hapticLight}
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
      onClick={hapticLight}
    >
      {inner}
    </Link>
  );
}


export default function HomeClient({ services, banners = [], defaultNotifications = [], welcomeToast }) {
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

  // Pull-to-refresh state
  const [pullDist, setPullDist] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullStartY = useRef(null);
  const PULL_THRESHOLD = 80;

  const onPullStart = useCallback((e) => {
    if (window.scrollY === 0) {
      pullStartY.current = e.touches[0].clientY;
    }
  }, []);

  const onPullMove = useCallback((e) => {
    if (pullStartY.current === null || isRefreshing) return;
    const dy = e.touches[0].clientY - pullStartY.current;
    if (dy > 0) {
      e.preventDefault();
      setPullDist(Math.min(dy, PULL_THRESHOLD + 20));
    } else {
      pullStartY.current = null;
      setPullDist(0);
    }
  }, [isRefreshing]);

  const onPullEnd = useCallback(() => {
    if (pullDist >= PULL_THRESHOLD) {
      setIsRefreshing(true);
      setPullDist(0);
      pullStartY.current = null;
      setTimeout(() => window.location.reload(), 300);
    } else {
      setPullDist(0);
      pullStartY.current = null;
    }
  }, [pullDist]);

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
      onTouchStart={onPullStart}
      onTouchMove={onPullMove}
      onTouchEnd={onPullEnd}
    >
      {/* Pull-to-refresh indicator */}
      {(pullDist > 0 || isRefreshing) && (
        <div
          className="fixed top-0 left-0 right-0 flex items-center justify-center z-50 transition-all duration-150"
          style={{ height: isRefreshing ? 48 : Math.max(pullDist * 0.6, 0), overflow: "hidden" }}
        >
          <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
            {isRefreshing
              ? (lang === "fa" ? "در حال بارگذاری..." : "Refreshing...")
              : (lang === "fa" ? "↓ برای بارگذاری مجدد بکشید" : "↓ Pull to refresh")}
          </span>
        </div>
      )}

      {/* Background glows */}
      <div className="dark-only fixed inset-0 pointer-events-none overflow-hidden">
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
        <PageHeader isHomeContext={true} />

        {/* Banner carousel — hidden when no active banners */}
        {visibleBanners.length > 0 && (
          <section className="mb-5">
            <div
              dir="ltr"
              className={`relative overflow-hidden rounded-[28px] h-[104px] cursor-pointer transition-transform duration-150 select-none ${
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
              <div className="grid grid-cols-4 gap-4">
                {visibleServices.map((svc) => (
                  <ServiceItem key={svc.id} {...svc} lang={lang} />
                ))}
              </div>
            </section>
          );
        })()}
        <ProfileCompletionBar lang={lang} isRTL={isRTL} />
        <NewsStrip lang={lang} />
      </div>

      <BottomNav />
    </main>
  );
}
