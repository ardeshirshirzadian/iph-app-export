"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toPersianDigits, toEnglishDigits, toLocalMobile } from "@/lib/utils";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import LangToggle from "@/components/LangToggle";

export default function LoginForm({ settings, initialVerify, initialContact, initialIsEmail, quickMode = false, fromPath = '/' }) {
  const router = useRouter();
  const { lang, isRTL } = useLang();
  const [step, setStep] = useState(initialVerify ? 2 : 1);
  const normalizedContact = initialContact && !initialContact.includes('@')
    ? toLocalMobile(initialContact)
    : initialContact;
  const [contact, setContact] = useState(normalizedContact || ""); // mobile (fa) or email (en)
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isLight, setIsLight] = useState(false);
  const otpRefs = useRef([]);
  const quickAutoSent = useRef(false);
  const sendOtpCoreRef = useRef(null);

  const isEmail = lang === "en";

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
    const observer = new MutationObserver(() => {
      setIsLight(document.documentElement.classList.contains("light"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (step === 2) otpRefs.current[0]?.focus();
  }, [step]);

  // Reset form when language switches (skip in quick mode — contact is pre-filled)
  useEffect(() => {
    if (quickMode) return;
    setContact("");
    setStep(1);
    setError("");
    setOtpDigits(["", "", "", "", ""]);
  }, [lang, quickMode]);

  const otpValue = otpDigits.join("");
  const logoSrc = isLight ? settings.logo_path_light_theme : settings.logo_path;

  async function sendOtpCore() {
    setError("");
    setLoading(true);
    try {
      const endpoint = isEmail ? "/api/auth/send-otp-email" : "/api/auth/send-otp";
      const body = isEmail ? { email: contact } : { mobile: contact };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setStep(2);
        setResendCooldown(60);
      } else {
        setError(data.message || (isEmail ? "Failed to send code" : "خطا در ارسال کد"));
      }
    } catch {
      setError(t(lang, "server_error"));
    } finally {
      setLoading(false);
    }
  }

  // Keep ref current so the deferred auto-send always sees the latest closure
  sendOtpCoreRef.current = sendOtpCore;

  // Auto-send OTP on mount in quick mode; defer via setTimeout to let lang
  // initialize from localStorage before firing (useLang reads it in useEffect)
  useEffect(() => {
    if (!quickMode || !initialContact) return;
    const id = setTimeout(() => {
      if (!quickAutoSent.current) {
        quickAutoSent.current = true;
        sendOtpCoreRef.current();
      }
    }, 0);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSendOtp(e) {
    e.preventDefault();
    await sendOtpCore();
  }

  const submitOtp = useCallback(
    async (code) => {
      setError("");
      setLoading(true);
      try {
        const endpoint = isEmail ? "/api/auth/verify-otp-email" : "/api/auth/verify-otp";
        const body = isEmail ? { email: contact, code } : { mobile: contact, code };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success) {
          if (!quickMode) {
            sessionStorage.setItem(
              "iph_show_welcome",
              JSON.stringify({
                firstname_fa: data.firstname_fa || "",
                lastname_fa: data.lastname_fa || "",
              })
            );
          }
          router.push(quickMode ? fromPath : "/");
        } else {
          setError(data.message || (isEmail ? "Incorrect code" : "کد وارد شده اشتباه است"));
        }
      } catch {
        setError(t(lang, "server_error"));
      } finally {
        setLoading(false);
      }
    },
    [contact, isEmail, lang, router, quickMode, fromPath]
  );

  async function handleVerifyOtp(e) {
    e.preventDefault();
    await submitOtp(otpValue);
  }

  function handleOtpChange(index, value) {
    const digit = toEnglishDigits(value).replace(/\D/g, "").slice(-1);
    const newDigits = [...otpDigits];
    newDigits[index] = digit;
    setOtpDigits(newDigits);
    if (digit && index < 4) otpRefs.current[index + 1]?.focus();
    if (digit && index === 4 && newDigits.every((d) => d !== "")) {
      submitOtp(newDigits.join(""));
    }
  }

  function handleOtpKeyDown(index, e) {
    if (e.key === "Backspace" && otpDigits[index] === "" && index > 0) {
      const newDigits = [...otpDigits];
      newDigits[index - 1] = "";
      setOtpDigits(newDigits);
      otpRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e) {
    e.preventDefault();
    const pasted = toEnglishDigits(e.clipboardData.getData("text")).replace(/\D/g, "").slice(0, 5);
    if (!pasted) return;
    const newDigits = ["", "", "", "", ""];
    for (let i = 0; i < pasted.length; i++) newDigits[i] = pasted[i];
    setOtpDigits(newDigits);
    const focusIndex = Math.min(pasted.length, 4);
    otpRefs.current[focusIndex]?.focus();
    if (pasted.length === 5) submitOtp(pasted);
  }

  async function handleResend() {
    if (resendCooldown > 0 || loading) return;
    setError("");
    setLoading(true);
    try {
      const endpoint = isEmail ? "/api/auth/send-otp-email" : "/api/auth/send-otp";
      const body = isEmail ? { email: contact } : { mobile: contact };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setResendCooldown(60);
        setOtpDigits(["", "", "", "", ""]);
        setTimeout(() => otpRefs.current[0]?.focus(), 0);
      } else {
        setError(data.message || t(lang, "server_error"));
      }
    } catch {
      setError(t(lang, "server_error"));
    } finally {
      setLoading(false);
    }
  }

  const isMobileValid = !isEmail && contact.length === 11;
  const isEmailValid = isEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  const isContactValid = isEmail ? isEmailValid : isMobileValid;

  const dir = isRTL ? "rtl" : "ltr";

  return (
    <main
      dir={dir}
      lang={lang}
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      {/* Background glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      {/* Language toggle — top corner */}
      <div className="fixed top-4 left-4 z-10">
        <LangToggle />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          {(() => {
            const sz = parseInt(settings.logo_size ?? "80", 10) || 80;
            return (
              <div style={{ width: sz, height: sz }} className="mx-auto mb-4 flex items-center justify-center">
                {logoSrc && (
                  <img src={logoSrc} alt={t(lang, "app_name")} className="w-full h-full object-contain" />
                )}
              </div>
            );
          })()}
          <h1 className="text-2xl font-black" style={{ color: "var(--text)" }}>
            {isEmail ? (settings.title_en || t(lang, "app_name")) : settings.title}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-dim)" }}>
            {quickMode
              ? (isEmail ? "Enter the verification code to continue" : "برای ادامه کد تأیید را وارد کنید")
              : (isEmail ? (settings.subtitle_en || t(lang, "login_subtitle")) : settings.subtitle)}
          </p>
        </div>

        {/* Card */}
        <div
          className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-6"
          style={{ background: "var(--surface)" }}
        >
          {step === 1 ? (
            <form onSubmit={handleSendOtp}>
              <label
                htmlFor="contact"
                className="block text-sm font-medium mb-2"
                style={{ color: "var(--text-dim)" }}
              >
                {isEmail ? t(lang, "email_label") : settings.mobile_label}
              </label>

              {isEmail ? (
                <input
                  id="contact"
                  type="email"
                  dir="ltr"
                  value={contact}
                  onChange={(e) => setContact(e.target.value.trim())}
                  placeholder={t(lang, "email_placeholder")}
                  inputMode="email"
                  autoComplete="email"
                  required
                  className="w-full rounded-xl px-4 py-3 text-base outline-none border transition-colors"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    borderColor: "var(--border)",
                    textAlign: "left",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(0,255,179,0.4)")}
                  onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
                />
              ) : (
                <input
                  id="contact"
                  type="tel"
                  dir="ltr"
                  value={toPersianDigits(contact)}
                  onChange={(e) => setContact(toEnglishDigits(e.target.value).replace(/\D/g, "").slice(0, 11))}
                  placeholder={settings.mobile_placeholder}
                  maxLength={11}
                  inputMode="numeric"
                  required
                  className="w-full rounded-xl px-4 py-3 text-lg tracking-widest outline-none border transition-colors"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    borderColor: "var(--border)",
                    textAlign: "right",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = "rgba(0,255,179,0.4)")}
                  onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
                />
              )}

              {error && (
                <p className="mt-3 text-sm text-center" style={{ color: "#ff6b6b" }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !isContactValid}
                className="w-full mt-4 py-3 rounded-xl font-bold transition-opacity disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#021f20" }}
              >
                {loading ? t(lang, "sending") : (isEmail ? (settings.submit_button_text_en || t(lang, "submit_button")) : settings.submit_button_text)}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <p className="text-sm font-bold mb-4" style={{ color: "var(--text)" }}>
                {isEmail ? (settings.otp_title_en || t(lang, "otp_title")) : settings.otp_title}
              </p>

              <div className="mb-4">
                <p className="text-xs mb-0.5" style={{ color: "var(--text-dim)" }}>
                  {isEmail ? (settings.otp_subtitle_en || t(lang, "otp_subtitle")) : settings.otp_subtitle}
                </p>
                <p
                  className="text-sm font-bold"
                  style={{ color: "var(--text)", direction: "ltr", textAlign: isRTL ? "right" : "left" }}
                >
                  {isEmail ? contact : toPersianDigits(contact)}
                </p>
              </div>

              <label className="block text-sm font-medium mb-3" style={{ color: "var(--text-dim)" }}>
                {isEmail ? (settings.otp_code_label_en || t(lang, "otp_code_label")) : settings.otp_code_label}
              </label>

              <div dir="ltr" className="flex gap-2 justify-center">
                {otpDigits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => (otpRefs.current[index] = el)}
                    type="text"
                    inputMode="numeric"
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    maxLength={1}
                    value={toPersianDigits(digit)}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    onPaste={handleOtpPaste}
                    className="w-12 h-14 rounded-xl border text-center text-xl font-bold outline-none transition-colors backdrop-blur-xl bg-white/5"
                    style={{
                      color: "var(--text)",
                      borderColor: digit ? "rgba(0,255,179,0.4)" : "rgba(255,255,255,0.1)",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "rgba(0,255,179,0.5)")}
                    onBlur={(e) =>
                      (e.target.style.borderColor = digit ? "rgba(0,255,179,0.4)" : "rgba(255,255,255,0.1)")
                    }
                  />
                ))}
              </div>

              {error && (
                <p className="mt-3 text-sm text-center" style={{ color: "#ff6b6b" }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || otpValue.length < 5}
                className="w-full mt-4 py-3 rounded-xl font-bold transition-opacity disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#021f20" }}
              >
                {loading
                  ? t(lang, "verifying")
                  : (isEmail ? (settings.verify_button_text_en || t(lang, "verify_button")) : settings.verify_button_text)}
              </button>

              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendCooldown > 0 || loading}
                  className="text-sm transition-opacity disabled:opacity-40"
                  style={{ color: "var(--accent)" }}
                >
                  {resendCooldown > 0
                    ? `${isEmail ? (settings.resend_otp_text_en || t(lang, "resend_otp")) : settings.resend_otp_text} (${isRTL ? toPersianDigits(resendCooldown) : resendCooldown}${isRTL ? " ثانیه" : t(lang, "resend_seconds")})`
                    : (isEmail ? (settings.resend_otp_text_en || t(lang, "resend_otp")) : settings.resend_otp_text)}
                </button>
              </div>

              <div className="mt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setOtpDigits(["", "", "", "", ""]);
                    setError("");
                  }}
                  className="text-xs"
                  style={{ color: "var(--text-dim)" }}
                >
                  {isEmail ? (settings.edit_mobile_text_en || t(lang, "edit_contact")) : settings.edit_mobile_text}
                </button>
              </div>
            </form>
          )}
        </div>
        {/* Create account link */}
        <div className="mt-4 text-center text-sm" style={{ color: "var(--text-dim)" }}>
          {isRTL ? "حساب کاربری ندارید؟ " : "Don't have an account? "}
          <Link
            href="/signup"
            className="font-bold"
            style={{ color: "var(--accent)" }}
          >
            {isRTL ? "ایجاد حساب" : "Create Account"}
          </Link>
        </div>
      </div>
    </main>
  );
}
