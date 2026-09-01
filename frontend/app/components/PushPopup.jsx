"use client";

import { useEffect, useState } from "react";
import { isPushSupported, isIOS, isStandalone, requestNotificationPermission, subscribeToPush } from "@/lib/pushClient";
import { t } from "@/lib/i18n";

function isSvgIconPath(value) {
  return typeof value === "string" && value.toLowerCase().endsWith(".svg");
}

// Per-theme colorable SVG icon -- same CSS mask-image + backgroundColor
// technique as QuestIcon in app/quest/QuestClient.js, reused here so an
// uploaded SVG push-prompt icon can be themed the same way Quest badge/
// mission icons are.
function SvgIcon({ path, size, colorDark, colorLight }) {
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
    <span
      style={{
        display: "block",
        width: size,
        height: size,
        flexShrink: 0,
        backgroundColor: color,
        WebkitMaskImage: `url('${path}')`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskImage: `url('${path}')`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
}

// Rendered once from HomeVariantRenderer so it shows regardless of which
// home variant (services grid, quest, map, ...) is currently configured --
// see that file's comment for why it moved out of HomeClient.js.
export default function PushPopup({ pushPrompt, lang }) {
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
    if (!localStorage.getItem('show_push_popup')) return;
    setVisible(true);
  }, [prompt.enabled]);

  async function handleEnable() {
    setStatus('loading');
    const perm = await requestNotificationPermission();
    localStorage.removeItem('show_push_popup');
    localStorage.setItem('push_banner_dismissed', '1');
    if (perm !== 'granted') {
      setStatus('denied');
      setTimeout(() => setVisible(false), 2500);
      return;
    }
    const result = await subscribeToPush();
    setStatus(result.ok ? 'done' : 'denied');
    setTimeout(() => setVisible(false), result.ok ? 1800 : 2500);
  }

  function handleDismiss() {
    localStorage.removeItem('show_push_popup');
    localStorage.setItem('push_banner_dismissed', '1');
    setVisible(false);
  }

  if (!visible) return null;

  const iconSz = prompt.icon_size ?? 40;
  const icon = prompt.icon_type === 'image' && prompt.icon_value
    ? (
      isSvgIconPath(prompt.icon_value)
        ? <SvgIcon path={prompt.icon_value} size={iconSz} colorDark={prompt.icon_color_dark} colorLight={prompt.icon_color_light} />
        : <img src={prompt.icon_value} alt="" style={{ width: iconSz, height: iconSz, objectFit: 'contain' }} />
    )
    : <span style={{ fontSize: iconSz, lineHeight: 1 }}>{prompt.icon_value || '🔔'}</span>;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-6"
        style={{
          background: "color-mix(in srgb, var(--accent) 8%, var(--surface))",
          border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
          backdropFilter: 'blur(24px)',
        }}
      >
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 mt-0.5">{icon}</div>
          <div className="flex-1 min-w-0">
            {status === 'done' ? (
              <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                {t(lang, 'push_done')}
              </p>
            ) : status === 'denied' ? (
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {t(lang, 'push_denied')}
              </p>
            ) : (
              <>
                <p className="text-base font-semibold mb-1.5" style={{ color: "var(--text)" }}>
                  {prompt.title}
                </p>
                {prompt.description && (
                  <p className="text-sm leading-relaxed mb-3" style={{ color: "var(--text-muted)" }}>
                    {prompt.description}
                  </p>
                )}
                {ios && !standalone && (
                  <p className="text-xs mb-3 leading-relaxed" style={{ color: "color-mix(in srgb, var(--accent) 80%, var(--text-muted))" }}>
                    {t(lang, 'push_ios_hint')}
                  </p>
                )}
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={handleEnable}
                    disabled={status === 'loading'}
                    className="text-sm font-bold rounded-xl px-5 py-2"
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
                    className="text-sm rounded-xl px-5 py-2"
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
      </div>
    </div>
  );
}
