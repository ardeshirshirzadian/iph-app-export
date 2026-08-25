"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import { getFormOptions } from "@/lib/formOptionsCache";
import { toPersianDigits, toEnglishDigits, toLocalMobile, filterNameByLang } from "@/lib/utils";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import LangToggle from "@/components/LangToggle";
import { hapticError } from "@/lib/haptics";
import Button from "@/components/Button";

const SEND_OTP = gql`
  mutation SendOtp($mobile: String, $email: String) {
    attendeeLogin(mobile: $mobile, email: $email)
  }
`;

const VERIFY_OTP = gql`
  mutation VerifyOtp($mobile: String, $email: String, $code: String!) {
    attendeeLoginValidateOTP(mobile: $mobile, email: $email, code: $code)
  }
`;


const REGISTER_MUTATION = gql`
  mutation Register(
    $firstnameFa: String!, $lastnameFa: String!,
    $firstnameEn: String, $lastnameEn: String,
    $mobile: String, $email: String,
    $mobileSignature: String, $emailSignature: String,
    $occupationId: Int, $fieldOfActivities: [Int!]!,
    $industryId: Int
  ) {
    attendeeRegister(
      firstnameFa: $firstnameFa, lastnameFa: $lastnameFa,
      firstnameEn: $firstnameEn, lastnameEn: $lastnameEn,
      mobile: $mobile, email: $email,
      mobileSignature: $mobileSignature, emailSignature: $emailSignature,
      occupationId: $occupationId, fieldOfActivities: $fieldOfActivities,
      industryId: $industryId
    )
  }
`;

const FIELD_STYLE = {
  background: "var(--surface-2)",
  color: "var(--text)",
  borderColor: "var(--border)",
};

const SELECT_STYLE = {
  ...FIELD_STYLE,
  appearance: "none",
  WebkitAppearance: "none",
  cursor: "pointer",
};

// Translucent, theme-aware accent tint for focus/active borders — derived from
// var(--accent) via color-mix() (same technique lib/getThemeColors.js already
// uses for --surface-alt) instead of a color hardcoded to the dark-theme accent.
const ACCENT_BORDER = "color-mix(in srgb, var(--accent) 40%, transparent)";
const ACCENT_BORDER_STRONG = "color-mix(in srgb, var(--accent) 55%, transparent)";

function focusAccentBorder(e) {
  e.target.style.borderColor = ACCENT_BORDER;
}
function blurDefaultBorder(e) {
  e.target.style.borderColor = "var(--border)";
}

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

  // Step 3: no Rasayesh account exists for `contact` yet — collect the rest
  // of the profile, then call attendeeRegister with the real signature we
  // got back from attendeeLoginValidateOTP for this exact contact.
  const [pendingSignature, setPendingSignature] = useState("");
  const [profileForm, setProfileForm] = useState({
    firstnameFa: "", lastnameFa: "", firstnameEn: "", lastnameEn: "",
    otherContact: "", occupationId: "", fieldOfActivities: [],
  });
  const [formOptions, setFormOptions] = useState({ occupations: [], fieldOfActivities: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const otpRefs = useRef([]);
  const quickAutoSent = useRef(false);
  const sendOtpCoreRef = useRef(null);
  // Synchronous guard — React state (loading) is async and can't prevent
  // same-tick duplicate calls from the auto-submit and paste handlers.
  const submittingRef = useRef(false);

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
    setPendingSignature("");
    setProfileForm({
      firstnameFa: "", lastnameFa: "", firstnameEn: "", lastnameEn: "",
      otherContact: "", occupationId: "", fieldOfActivities: [],
    });
  }, [lang, quickMode]);

  // Lazily load occupation/field-of-activity options once we know contact is a new attendee
  useEffect(() => {
    if (step !== 3) return;
    getFormOptions()
      .then((data) => setFormOptions({
        occupations: data.occupations,
        fieldOfActivities: data.fieldOfActivities,
      }))
      .catch(() => {})
      .finally(() => setOptionsLoading(false));
  }, [step]);

  const otpValue = otpDigits.join("");
  const logoSrc = isLight ? settings.logo_path_light_theme : settings.logo_path;

  async function sendOtpCore() {
    setError("");
    setLoading(true);
    try {
      const client = getApolloClient();
      const variables = isEmail ? { email: contact } : { mobile: contact };
      const { data, errors } = await client.mutate({ mutation: SEND_OTP, variables });

      if (errors?.length) {
        hapticError();
        setError(isEmail ? "Failed to send code" : "خطا در ارسال کد");
        return;
      }

      const result = data?.attendeeLogin;
      const ok = result?.status && result.status !== 'fail' && result.status !== 'error';

      if (ok) {
        setStep(2);
        setResendCooldown(60);
      } else {
        hapticError();
        setError(result?.message || (isEmail ? "Failed to send code" : "خطا در ارسال کد"));
      }
    } catch {
      hapticError();
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

  // Shared by both the existing-user login success path and the
  // new-attendee-then-register success path — attendeeRegister returns the
  // same { user, accessToken, refreshToken } shape attendeeLoginValidateOTP
  // does, so a freshly registered user is logged in immediately, no separate
  // login call needed.
  const finalizeSession = useCallback(
    async (result) => {
      // Store tokens in localStorage
      localStorage.setItem('access_token', result.accessToken);
      localStorage.setItem('refresh_token', result.refreshToken);

      // Set iph_user cookie + upsert DB (fire-and-forget for the upsert)
      const u = result.user || {};
      await fetch('/api/auth/finalize-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: u }),
      });

      // Auto-enroll in free plan if admin has enabled it and user has no plan.
      // Fire-and-forget: a failure here MUST NOT block login.
      if (result.accessToken && u.uuid) {
        fetch('/api/auth/auto-enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: result.accessToken, uuid: u.uuid }),
        }).catch(() => {});
      }

      if (
        !localStorage.getItem('push_banner_dismissed') &&
        'Notification' in window &&
        Notification.permission === 'default'
      ) {
        localStorage.setItem('show_push_popup', '1');
      }

      if (!quickMode) {
        sessionStorage.setItem(
          "iph_show_welcome",
          JSON.stringify({
            firstname_fa: u.firstname_fa || "",
            lastname_fa: u.lastname_fa || "",
          })
        );
      }
      router.push(quickMode ? fromPath : "/");
    },
    [quickMode, fromPath, router]
  );

  const submitOtp = useCallback(
    async (code) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setError("");
      setLoading(true);
      try {
        const client = getApolloClient();
        const variables = isEmail
          ? { email: contact, code }
          : { mobile: contact, code };
        const { data, errors } = await client.mutate({ mutation: VERIFY_OTP, variables });

        if (errors?.length) {
          hapticError();
          setError(isEmail ? "Incorrect code" : "کد وارد شده اشتباه است");
          return;
        }

        const raw = data?.attendeeLoginValidateOTP;
        const result = typeof raw === 'string' ? JSON.parse(raw) : raw;

        if (result?.status === 'new-attendee') {
          // No Rasayesh account exists for this contact yet. Hold onto the
          // real signature returned here — this is what proves ownership of
          // this exact mobile/email to attendeeRegister. Never substitute a
          // fabricated value for it.
          setPendingSignature(result.signature || "");
          setStep(3);
          return;
        }

        if (result?.status !== 'success') {
          hapticError();
          setError(result?.message || (isEmail ? "Incorrect code" : "کد وارد شده اشتباه است"));
          return;
        }

        await finalizeSession(result);
      } catch {
        hapticError();
        setError(t(lang, "server_error"));
      } finally {
        setLoading(false);
        submittingRef.current = false;
      }
    },
    [contact, isEmail, lang, finalizeSession]
  );

  async function handleVerifyOtp(e) {
    e.preventDefault();
    await submitOtp(otpValue);
  }

  function setProfileField(field, value) {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleActivity(id) {
    setProfileForm((prev) => {
      const next = prev.fieldOfActivities.includes(id)
        ? prev.fieldOfActivities.filter((x) => x !== id)
        : [...prev.fieldOfActivities, id];
      return { ...prev, fieldOfActivities: next };
    });
  }

  function isProfileValid() {
    const nameOk = isEmail
      ? profileForm.firstnameEn.trim() && profileForm.lastnameEn.trim()
      : profileForm.firstnameFa.trim() && profileForm.lastnameFa.trim()
        && profileForm.firstnameEn.trim() && profileForm.lastnameEn.trim();
    const otherOk = isEmail
      ? profileForm.otherContact.length === 11
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileForm.otherContact);
    const activitiesOk =
      formOptions.fieldOfActivities.length === 0 || profileForm.fieldOfActivities.length > 0;
    return Boolean(nameOk && otherOk && profileForm.occupationId && activitiesOk);
  }

  async function handleRegisterSubmit(e) {
    e.preventDefault();
    if (!isProfileValid()) return;
    setError("");
    setLoading(true);
    try {
      const client = getApolloClient();
      const variables = {
        // Rasayesh expects both FA and EN names; fall back to the other
        // language's value when one side was left blank.
        firstnameFa: profileForm.firstnameFa || profileForm.firstnameEn,
        lastnameFa: profileForm.lastnameFa || profileForm.lastnameEn,
        firstnameEn: profileForm.firstnameEn || profileForm.firstnameFa,
        lastnameEn: profileForm.lastnameEn || profileForm.lastnameFa,
        mobile: isEmail ? profileForm.otherContact : contact,
        email: isEmail ? contact : profileForm.otherContact,
        occupationId: profileForm.occupationId ? parseInt(profileForm.occupationId, 10) : undefined,
        fieldOfActivities: profileForm.fieldOfActivities.map(Number).filter(Boolean),
        industryId: 1,
        // Only the channel actually OTP-verified in step 2 gets a signature;
        // the other side is sent as a plain unverified string (confirmed
        // accepted live) — never a fabricated signature.
        ...(isEmail ? { emailSignature: pendingSignature } : { mobileSignature: pendingSignature }),
      };

      const { data, errors } = await client.mutate({ mutation: REGISTER_MUTATION, variables });

      if (errors?.length) {
        hapticError();
        setError(errors[0].message || (isEmail ? "Failed to create account" : "خطا در ایجاد حساب"));
        return;
      }

      const raw = data?.attendeeRegister;
      const result = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (result?.status !== 'success') {
        hapticError();
        setError(result?.message || (isEmail ? "Failed to create account" : "خطا در ایجاد حساب"));
        return;
      }

      await finalizeSession(result);
    } catch {
      hapticError();
      setError(t(lang, "server_error"));
    } finally {
      setLoading(false);
    }
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
      const client = getApolloClient();
      const variables = isEmail ? { email: contact } : { mobile: contact };
      const { data, errors } = await client.mutate({ mutation: SEND_OTP, variables });

      if (errors?.length) {
        hapticError();
        setError(t(lang, "server_error"));
        return;
      }

      const result = data?.attendeeLogin;
      const ok = result?.status && result.status !== 'fail' && result.status !== 'error';

      if (ok) {
        setResendCooldown(60);
        setOtpDigits(["", "", "", "", ""]);
        setTimeout(() => otpRefs.current[0]?.focus(), 0);
      } else {
        hapticError();
        setError(result?.message || t(lang, "server_error"));
      }
    } catch {
      hapticError();
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
      <div className="dark-only fixed inset-0 pointer-events-none overflow-hidden">
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
            // Fixed height, width auto -- same technique AppHeader.js's Logo
            // uses (h-8 w-auto object-contain) for its non-square logo+wordmark
            // lockup: one controlled dimension, the other derived from the
            // image's own aspect ratio, so a rectangular logo isn't squashed
            // or letterboxed into a forced square.
            const height = parseInt(settings.logo_height ?? "80", 10) || 80;
            return (
              <div className="mx-auto mb-4 flex items-center justify-center">
                {logoSrc && (
                  <img
                    src={logoSrc}
                    alt={t(lang, "app_name")}
                    style={{ height, width: "auto" }}
                    className="object-contain"
                  />
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
                  onFocus={focusAccentBorder}
                  onBlur={blurDefaultBorder}
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
                  onFocus={focusAccentBorder}
                  onBlur={blurDefaultBorder}
                />
              )}

              {error && (
                <p className="mt-3 text-sm text-center" style={{ color: "#ff6b6b" }}>
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading || !isContactValid}
                variant="primary"
                className="w-full mt-4"
                size="lg"
              >
                {loading ? t(lang, "sending") : (isEmail ? (settings.submit_button_text_en || t(lang, "submit_button")) : settings.submit_button_text)}
              </Button>
            </form>
          ) : step === 2 ? (
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
                    className="w-12 h-14 rounded-xl border text-center text-xl font-bold outline-none transition-colors backdrop-blur-xl"
                    style={{
                      background: "var(--surface-2)",
                      color: "var(--text)",
                      borderColor: digit ? ACCENT_BORDER : "var(--border)",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = ACCENT_BORDER_STRONG)}
                    onBlur={(e) =>
                      (e.target.style.borderColor = digit ? ACCENT_BORDER : "var(--border)")
                    }
                  />
                ))}
              </div>

              {error && (
                <p className="mt-3 text-sm text-center" style={{ color: "#ff6b6b" }}>
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading || otpValue.length < 5}
                variant="primary"
                className="w-full mt-4"
                size="lg"
              >
                {loading
                  ? t(lang, "verifying")
                  : (isEmail ? (settings.verify_button_text_en || t(lang, "verify_button")) : settings.verify_button_text)}
              </Button>

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
          ) : (
            <form onSubmit={handleRegisterSubmit}>
              <p className="text-sm font-bold mb-1" style={{ color: "var(--text)" }}>
                {isEmail ? "Complete your profile" : "تکمیل اطلاعات حساب"}
              </p>
              <p className="text-xs mb-4" style={{ color: "var(--text-dim)" }}>
                {isEmail
                  ? "No account found for this email yet — fill in a few details to create one."
                  : "حساب کاربری برای این شماره یافت نشد. برای ساخت حساب اطلاعات زیر را تکمیل کنید."}
              </p>

              <div className="space-y-3">
                {isEmail ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        First Name<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        dir="ltr"
                        type="text"
                        value={profileForm.firstnameEn}
                        onChange={(e) => setProfileField("firstnameEn", filterNameByLang(e.target.value, "en"))}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="First name"
                        autoComplete="given-name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        Last Name<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        dir="ltr"
                        type="text"
                        value={profileForm.lastnameEn}
                        onChange={(e) => setProfileField("lastnameEn", filterNameByLang(e.target.value, "en"))}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="Last name"
                        autoComplete="family-name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        Mobile<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        dir="ltr"
                        type="tel"
                        inputMode="numeric"
                        value={profileForm.otherContact}
                        onChange={(e) =>
                          setProfileField("otherContact", toEnglishDigits(e.target.value).replace(/\D/g, "").slice(0, 11))
                        }
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="09xxxxxxxxx"
                        maxLength={11}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        نام<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        dir="rtl"
                        type="text"
                        value={profileForm.firstnameFa}
                        onChange={(e) => setProfileField("firstnameFa", filterNameByLang(e.target.value, "fa"))}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="نام"
                        autoComplete="given-name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        نام خانوادگی<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        dir="rtl"
                        type="text"
                        value={profileForm.lastnameFa}
                        onChange={(e) => setProfileField("lastnameFa", filterNameByLang(e.target.value, "fa"))}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="نام خانوادگی"
                        autoComplete="family-name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        نام انگلیسی<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        dir="ltr"
                        type="text"
                        value={profileForm.firstnameEn}
                        onChange={(e) => setProfileField("firstnameEn", filterNameByLang(e.target.value, "en"))}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="First name (Latin)"
                        autoComplete="given-name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        نام خانوادگی انگلیسی<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        dir="ltr"
                        type="text"
                        value={profileForm.lastnameEn}
                        onChange={(e) => setProfileField("lastnameEn", filterNameByLang(e.target.value, "en"))}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="Last name (Latin)"
                        autoComplete="family-name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        ایمیل<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        dir="ltr"
                        type="email"
                        inputMode="email"
                        value={profileForm.otherContact}
                        onChange={(e) => setProfileField("otherContact", e.target.value.trim())}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="you@example.com"
                      />
                    </div>
                  </>
                )}

                {optionsLoading ? (
                  <p className="text-xs text-center py-2" style={{ color: "var(--text-dim)" }}>
                    {isEmail ? "Loading..." : "در حال بارگذاری..."}
                  </p>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        {isEmail ? "Occupation" : "شغل"}<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <select
                        value={profileForm.occupationId}
                        onChange={(e) => setProfileField("occupationId", e.target.value)}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={{ ...SELECT_STYLE, direction: dir }}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                      >
                        <option value="">{isEmail ? "Select occupation..." : "انتخاب کنید..."}</option>
                        {formOptions.occupations.map((o) => (
                          <option key={o.id} value={o.id}>
                            {isEmail ? (o.title_en || o.title_fa) : (o.title_fa || o.title_en)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {formOptions.fieldOfActivities.length > 0 && (
                      <div>
                        <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                          {isEmail ? "Field of Activity" : "حوزه فعالیت"}<span style={{ color: "var(--accent)" }}> *</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {formOptions.fieldOfActivities.map((f) => {
                            const isActive = profileForm.fieldOfActivities.includes(f.id);
                            return (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => toggleActivity(f.id)}
                                className="text-xs px-3 py-1.5 rounded-full transition-all border"
                                style={{
                                  background: isActive ? "var(--accent)" : "var(--surface-2)",
                                  color: isActive ? "var(--bg)" : "var(--text-dim)",
                                  borderColor: isActive ? "var(--accent)" : "var(--border)",
                                  fontWeight: isActive ? 700 : 400,
                                }}
                              >
                                {isEmail ? (f.title_en || f.title_fa) : (f.title_fa || f.title_en)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {error && (
                <p className="mt-3 text-sm text-center" style={{ color: "#ff6b6b" }}>
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading || !isProfileValid()}
                variant="primary"
                className="w-full mt-4"
                size="lg"
              >
                {loading
                  ? (isEmail ? "Creating account..." : "در حال ایجاد حساب...")
                  : (isEmail ? "Create Account" : "ایجاد حساب")}
              </Button>

              <div className="mt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setContact("");
                    setOtpDigits(["", "", "", "", ""]);
                    setPendingSignature("");
                    setError("");
                  }}
                  className="text-xs"
                  style={{ color: "var(--text-dim)" }}
                >
                  {isEmail ? "Start over" : "شروع دوباره"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
