"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import { toPersianDigits } from "@/lib/utils";

export default function QRScanPage() {
  const router = useRouter();
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const processingRef = useRef(false);
  const [status, setStatus] = useState("requesting"); // requesting | scanning | error | success
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const [scanResult, setScanResult] = useState(null); // { company, alreadyScanned, cooldown, outsideWindow, startHour, endHour, minutesRemaining, points, bonus, bonus_xp }
  const [logoErr, setLogoErr] = useState(false);
  const { lang, isRTL } = useLang();

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }, []);

  const stopScanner = useCallback(() => {
    if (controlsRef.current) {
      try { controlsRef.current.stop(); } catch (_) {}
      controlsRef.current = null;
    }
  }, []);

  const handleResult = useCallback(
    async (text) => {
      if (processingRef.current) return;

      if (!text.startsWith("IPH-BOOTH-")) {
        showToast(t(lang, "scan_invalid_qr"));
        return;
      }

      processingRef.current = true;
      stopScanner();

      const uuid = text.replace("IPH-BOOTH-", "");

      try {
        const res = await fetch("/api/quest/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uuid }),
        });

        const data = await res.json();

        if (res.status === 401 || data.error === "session_expired") {
          router.replace("/login");
          return;
        }

        if (data.error === "booth_not_found") {
          showToast(t(lang, "scan_invalid_qr"));
          processingRef.current = false;
          return;
        }

        if (data.status === 'outside_window') {
          setLogoErr(false);
          setScanResult({
            company: data.company,
            outsideWindow: true,
            startHour: data.start_hour,
            endHour: data.end_hour,
          });
          setStatus("success");
          setTimeout(() => router.replace("/quest"), 3500);
          return;
        }

        if (data.status === 'cooldown') {
          setLogoErr(false);
          setScanResult({
            company: data.company,
            cooldown: true,
            minutesRemaining: data.minutes_remaining,
          });
          setStatus("success");
          setTimeout(() => router.replace("/quest"), 3000);
          return;
        }

        setLogoErr(false);
        setScanResult({
          company: data.company,
          alreadyScanned: !!data.already_scanned,
          points: data.points || 10,
          bonus: !!data.bonus,
          bonus_xp: data.bonus_xp || 0,
        });
        setStatus("success");
        // Give the golden-booth celebration a bit more time to read
        setTimeout(() => router.replace("/quest"), data.bonus ? 4000 : 2500);
      } catch {
        showToast(t(lang, "server_error"));
        processingRef.current = false;
      }
    },
    [showToast, stopScanner, router, lang]
  );

  useEffect(() => {
    let active = true;

    async function startScanner() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (!active) return;

        setStatus("scanning");

        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current,
          (result) => {
            if (result) handleResult(result.getText());
          }
        );

        if (!active) { controls.stop(); return; }
        controlsRef.current = controls;
      } catch (err) {
        if (!active) return;
        const isPermission =
          err.name === "NotAllowedError" || err.name === "PermissionDeniedError";
        setErrorMsg(
          isPermission
            ? t(lang, "scan_camera_denied")
            : t(lang, "scan_camera_not_found")
        );
        setStatus("error");
      }
    }

    startScanner();

    return () => {
      active = false;
      if (controlsRef.current) {
        try { controlsRef.current.stop(); } catch (_) {}
        controlsRef.current = null;
      }
    };
  }, [handleResult, lang]);

  const goBack = useCallback(() => {
    stopScanner();
    router.replace("/quest");
  }, [stopScanner, router]);

  function getLogoUrl(logo, logoBaseUrl) {
    if (!logo) return null;
    const src = logo?.jpg?.["128"] || logo?.jpg?.["64"];
    if (!src) return null;
    return (logoBaseUrl || "https://api.rasayesh.com/") + src;
  }

  const logoUrl = (scanResult?.company && !logoErr)
    ? getLogoUrl(
        typeof scanResult.company.logo === "string"
          ? (() => { try { return JSON.parse(scanResult.company.logo); } catch { return null; } })()
          : scanResult.company.logo
      )
    : null;

  const companyName = scanResult?.company
    ? (lang === "fa"
        ? scanResult.company.brand_name_fa
        : scanResult.company.brand_name_en || scanResult.company.brand_name_fa)
    : null;

  return (
    <div
      className="fixed inset-0 bg-[#021f20] overflow-hidden"
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
    >
      <style>{`
        @keyframes scanLine {
          0%, 100% { top: 2.5rem; }
          50% { top: calc(100% - 2.5rem); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes successPulse {
          0%, 100% { box-shadow: 0 0 30px color-mix(in srgb, var(--accent) 35%, transparent); }
          50% { box-shadow: 0 0 60px color-mix(in srgb, var(--accent) 65%, transparent); }
        }
        .scan-back-btn:hover {
          background: color-mix(in srgb, var(--accent) 90%, black);
        }
      `}</style>

      {/* Camera feed — always mounted so the ref is ready */}
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
          status === "scanning" ? "opacity-100" : "opacity-0"
        }`}
        playsInline
        muted
      />

      {/* Overlay tint */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(2,31,32,0.5)" }}
      />

      {/* ── Top bar ── */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 pt-14 pb-4">
        <div className="w-10" />
        <h1 className="text-white font-bold text-base tracking-wide">{t(lang, "scan_title")}</h1>
        <button
          onClick={goBack}
          className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white/80 hover:bg-white/20 active:scale-95 transition-all"
          aria-label={t(lang, "scan_back_aria")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* ── Requesting permission ── */}
      {status === "requesting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 z-10">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-white font-medium leading-8">{t(lang, "scan_requesting")}</p>
            <p className="text-white/50 text-sm leading-7">{t(lang, "scan_confirm_access")}</p>
          </div>
        </div>
      )}

      {/* ── Scanning — QR frame overlay ── */}
      {status === "scanning" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
          <div className="relative w-64 h-64">
            {/* Corner brackets */}
            <svg className="absolute top-0 left-0" width="40" height="40" fill="none">
              <path d="M4 36 L4 4 L36 4" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <svg className="absolute top-0 right-0" width="40" height="40" fill="none">
              <path d="M4 4 L36 4 L36 36" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <svg className="absolute bottom-0 right-0" width="40" height="40" fill="none">
              <path d="M36 4 L36 36 L4 36" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <svg className="absolute bottom-0 left-0" width="40" height="40" fill="none">
              <path d="M36 36 L4 36 L4 4" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>

            {/* Animated scan line */}
            <div
              className="absolute left-3 right-3 h-px"
              style={{
                background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
                boxShadow: "0 0 6px color-mix(in srgb, var(--accent) 90%, transparent)",
                animation: "scanLine 2s ease-in-out infinite",
              }}
            />
          </div>

          <p className="text-white/90 text-sm mt-6 font-medium leading-7">
            {t(lang, "scan_instruction")}
          </p>
          <p className="text-white/40 text-xs mt-1">{t(lang, "scan_rear_camera")}</p>
        </div>
      )}

      {/* ── Camera error ── */}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 z-10 px-8">
          <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-lg leading-8">{t(lang, "scan_camera_access")}</p>
            <p className="text-white/50 text-sm leading-7 mt-1">{errorMsg}</p>
          </div>
          <button
            onClick={() => router.replace("/quest")}
            className="scan-back-btn font-bold rounded-xl px-8 py-3 active:scale-95 transition-all"
            style={{ background: "var(--accent)", color: "var(--btn-primary-text)" }}
          >
            {t(lang, "scan_back_to_missions")}
          </button>
        </div>
      )}

      {/* ── Success ── */}
      {status === "success" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 z-10 px-8">
          {/* Check icon or logo */}
          {logoUrl && !scanResult?.outsideWindow ? (
            <div
              className="w-24 h-24 rounded-2xl overflow-hidden flex items-center justify-center bg-white"
              style={{ animation: "successPulse 1.4s ease-in-out infinite", border: "2px solid var(--accent)" }}
            >
              <img src={logoUrl} alt="" onError={() => setLogoErr(true)} className="w-full h-full object-contain" />
            </div>
          ) : scanResult?.outsideWindow ? (
            <div className="w-24 h-24 rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
          ) : (
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center"
              style={{
                animation: "successPulse 1.4s ease-in-out infinite",
                background: "color-mix(in srgb, var(--accent) 20%, transparent)",
                border: "2px solid var(--accent)",
              }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          )}

          <div className="text-center">
            {scanResult?.outsideWindow ? (
              <>
                <p className="font-bold text-lg mb-1" style={{ color: "#f59e0b" }}>
                  {lang === "fa" ? "خارج از بازه فعال" : "Outside active hours"}
                </p>
                <p className="text-sm mb-2" style={{ color: "rgba(255,255,255,0.55)" }}>
                  {lang === "fa"
                    ? `این غرفه فقط بین ساعت ${toPersianDigits(scanResult.startHour)} تا ${toPersianDigits(scanResult.endHour)} امتیاز تکراری می‌دهد`
                    : `Repeat scoring active ${scanResult.startHour}:00–${scanResult.endHour}:00`}
                </p>
              </>
            ) : scanResult?.cooldown ? (
              <p className="font-bold text-lg mb-2" style={{ color: "#fbbf24" }}>
                {lang === "fa"
                  ? `${toPersianDigits(scanResult.minutesRemaining)} دقیقه دیگر مجدداً تلاش کنید`
                  : `${scanResult.minutesRemaining} min remaining`}
              </p>
            ) : scanResult?.alreadyScanned ? (
              <p className="font-bold text-lg mb-2" style={{ color: "#fbbf24" }}>
                {t(lang, "scan_already_scanned")}
              </p>
            ) : scanResult?.bonus ? (
              <>
                <p
                  dir="ltr"
                  className="font-black text-3xl mb-1"
                  style={{ color: "#ffd700", textShadow: "0 0 24px rgba(255,215,0,0.7)" }}
                >
                  +{lang === "fa" ? toPersianDigits(scanResult.points) : scanResult.points} XP!
                </p>
                <p className="font-bold text-base mb-1" style={{ color: "#ffd700" }}>
                  {lang === "fa"
                    ? <>🎉 تبریک! <span dir="ltr">+{toPersianDigits(scanResult.bonus_xp)}</span> امتیاز غرفه برتر گرفتید</>
                    : `🎉 Golden Booth! +${scanResult.bonus_xp} bonus XP`}
                </p>
              </>
            ) : (
              <p
                dir="ltr"
                className="font-black text-3xl mb-2"
                style={{ color: "var(--accent)", textShadow: "0 0 20px color-mix(in srgb, var(--accent) 50%, transparent)" }}
              >
                +{lang === "fa" ? toPersianDigits(scanResult?.points ?? 10) : (scanResult?.points ?? 10)} XP!
              </p>
            )}

            {companyName && (
              <p className="text-white font-bold text-xl leading-8">{companyName}</p>
            )}

            {scanResult?.company?.hall_name && (
              <p className="text-white/60 text-sm mt-1">
                {lang === "fa" ? "سالن" : "Hall"}{" "}
                {lang === "fa" ? toPersianDigits(scanResult.company.hall_name) : scanResult.company.hall_name}
                {scanResult.company.booth_no && (
                  <> &nbsp;—&nbsp; {lang === "fa" ? "غرفه" : "Booth"} {lang === "fa" ? toPersianDigits(scanResult.company.booth_no) : scanResult.company.booth_no}</>
                )}
              </p>
            )}

            {!scanResult?.alreadyScanned && !scanResult?.cooldown && !scanResult?.outsideWindow && (
              <p className="text-white/40 text-sm mt-2">{t(lang, "scan_success_title")}</p>
            )}
          </div>

          <div className="flex items-center gap-2 text-white/40 text-sm">
            <div className="w-4 h-4 rounded-full border-2 border-white/20 animate-spin" style={{ borderTopColor: "var(--accent)" }} />
            <span>{t(lang, "scan_returning")}</span>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          key={toast}
          className="absolute bottom-24 left-4 right-4 z-30 flex justify-center"
          style={{ animation: "fadeInUp 0.3s ease-out" }}
        >
          <div className="bg-[#021f20]/95 backdrop-blur-xl border border-white/20 rounded-2xl px-6 py-3.5 text-white text-sm font-medium shadow-2xl">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
