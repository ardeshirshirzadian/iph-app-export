"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import { getFormOptions } from "@/lib/formOptionsCache";
import { getInvalidProfileNameFields, nameScriptError, toPersianDigits, toEnglishDigits, toLocalMobile } from "@/lib/utils";
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

export default function LoginForm({ settings, initialVerify, initialContact, initialIsEmail, quickMode = false, fromPath = '/', referralCodeAvailable = false }) {
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
  const invalidProfileNameFields = new Set(getInvalidProfileNameFields(profileForm));
  const [formOptions, setFormOptions] = useState({ occupations: [], fieldOfActivities: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);
  // کد معرف (referral code) -- verified locally in the step-1 modal (no
  // Rasayesh call, no OTP needed), carried as plain state across steps
  // 1 -> 2/3 -> finalizeSession, where the real Rasayesh-dependent
  // enrollment check runs. Deliberately NOT reset by the lang-switch effect
  // below, unlike contact/step/otpDigits/profileForm -- switching fa/en
  // mid-flow must not silently drop an already-verified code.
  const [referralCode, setReferralCode] = useState("");
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [referralInput, setReferralInput] = useState("");
  const [referralChecking, setReferralChecking] = useState(false);
  const [referralModalError, setReferralModalError] = useState("");
  // Non-blocking informational message from the post-auth referral check
  // (redeem/route.js's 'already_enrolled' or 'pending' outcome) -- shown
  // briefly before finalizeSession's own redirect carries the user away.
  const [postAuthMessage, setPostAuthMessage] = useState("");
  // 'already_enrolled' means the referral did NOT count -- this must read as
  // a warning (same color as this form's error text), not a positive/accent
  // confirmation. 'pending' is neutral -- still awaiting a real answer, not
  // good or bad news yet. Only a genuinely accepted/counting code gets the
  // green checkmark treatment, and that's the separate step-1 badge above
  // (referralCode && ...), never this post-auth message.
  const [postAuthMessageType, setPostAuthMessageType] = useState("info");
  const otpRefs = useRef([]);
  const quickAutoSent = useRef(false);
  const sendOtpCoreRef = useRef(null);
  // Synchronous guard — React state (loading) is async and can't prevent
  // same-tick duplicate calls from the auto-submit and paste handlers.
  const submittingRef = useRef(false);

  const isEmail = lang === "en";
  // English/email mode has no Mobile field at all (see the foreign-registrant
  // flow above) -- so the referral-code contact-missing prompt must name
  // whichever field this mode actually collects, not always "mobile number".
  const referralContactMissingMessage = isEmail
    ? "Please enter your email first"
    : 'ابتدا شماره موبایل خود را وارد کنید';

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
  // theme x lang, same selection logic components/Logo.jsx uses for the
  // header logo (variantKey = `${theme}_${lang}`). Falls back to that exact
  // variant's own static default (DEFAULTS in page.js) when nothing's been
  // uploaded yet -- never borrows a different theme/lang's upload, since a
  // logo optimized for the wrong theme (e.g. light-on-light) can be illegible.
  const logoSrc = settings[`logo_path_${isLight ? "light" : "dark"}_${lang}`];

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

  // Local-only validation (no Rasayesh call) -- code exists, is active,
  // hasn't exceeded its usage cap, and this contact hasn't already redeemed
  // something for this event. A green check here can only ever mean "this
  // is a real code", not "you're eligible" -- eligibility can only be known
  // post-auth (see finalizeSession above).
  async function handleValidateReferralCode() {
    const trimmed = referralInput.trim();
    if (!trimmed || referralChecking) return;
    // Defense in depth -- the "کد معرف دارم" button already shows this same
    // message on click when contact is empty (see its onClick below), so
    // this shouldn't normally be reachable with an empty contact. Kept here
    // too in case the modal was already open when contact got cleared.
    // Without this, an empty contact silently 400s (missing_fields) and used
    // to render as the same "کد معرف نامعتبر است" text as a genuinely wrong
    // code (see 2026-09-16 فرخ ده بزرگی report -- the code was real and
    // active; the request never got past this check because contact was
    // empty).
    if (!contact.trim()) {
      setReferralModalError(referralContactMissingMessage);
      return;
    }
    setReferralChecking(true);
    setReferralModalError("");
    try {
      const res = await fetch('/api/quest/referral/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed, contact }),
      });
      const data = await res.json();
      if (data.ok) {
        setReferralCode(trimmed.toUpperCase());
        setShowReferralModal(false);
        setReferralInput("");
      } else if (data.error === 'already_used') {
        setReferralModalError(isEmail ? "This code has already been used" : 'این کد قبلاً استفاده شده');
      } else if (data.error === 'rate_limited') {
        setReferralModalError(isEmail
          ? "Too many attempts. Please try again later."
          : 'تعداد تلاش‌های شما بیش از حد مجاز است. کمی دیگر دوباره امتحان کنید.');
      } else if (data.error === 'code_capacity_reached') {
        // Distinct from "invalid_code" -- the code is real, just no longer
        // redeemable because its owner has already reached the highest
        // active tier's required count (see validate-code/route.js).
        setReferralModalError(isEmail ? "This code has reached its capacity" : 'ظرفیت این کد تکمیل شده است');
      } else if (data.error === 'missing_fields' || data.error === 'invalid_body') {
        // Distinct from "invalid_code" -- this means the request itself was
        // malformed (e.g. contact still empty), not that the code was
        // checked and found wrong. Kept as its own branch so this doesn't
        // masquerade as "invalid code" again if some other path ever hits it.
        setReferralModalError(referralContactMissingMessage);
      } else {
        setReferralModalError(isEmail ? "Invalid referral code" : 'کد معرف نامعتبر است');
      }
    } catch {
      setReferralModalError(t(lang, "server_error"));
    } finally {
      setReferralChecking(false);
    }
  }

  // Shared by both the existing-user login success path and the
  // new-attendee-then-register success path — attendeeRegister returns the
  // same { user, accessToken, refreshToken } shape attendeeLoginValidateOTP
  // does, so a freshly registered user is logged in immediately, no separate
  // login call needed.
  const finalizeSession = useCallback(
    async (result) => {
      // Post-auth referral-code check -- only runs if a code was verified in
      // step 1's modal. This is the one point a uuid + accessToken exist for
      // BOTH the existing-account path (submitOtp) and the new-account path
      // (handleRegisterSubmit), since both already funnel through this same
      // shared function -- no separate insertion point needed for each.
      // Must never block/fail login: any error here is swallowed silently.
      if (referralCode && result.accessToken && result.user?.uuid) {
        let infoMessage = "";
        let infoMessageType = "info";
        try {
          const res = await fetch('/api/quest/referral/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: referralCode,
              accessToken: result.accessToken,
              uuid: result.user.uuid,
            }),
          });
          const data = await res.json();
          if (data.outcome === 'already_enrolled') {
            // The referral did NOT count -- warning, not a success state.
            infoMessage = isEmail
              ? "You're already registered, so this referral code's reward won't be credited to you."
              : 'شما قبلا ثبت‌نام کرده‌اید، امتیاز این کد معرف به شما تعلق نمی‌گیرد.';
            infoMessageType = 'warning';
          } else if (data.outcome === 'pending') {
            infoMessage = isEmail
              ? "Your referral code has been recorded; it will be finalized the next time you log in."
              : 'کد معرف شما ثبت شد؛ برای نهایی‌شدن، دفعه بعد که وارد می‌شوید بررسی می‌شود.';
            infoMessageType = 'info';
          }
        } catch {
          // Rasayesh/network failure here must not block login -- fall
          // through to finalizeSession's normal body below regardless.
        }
        if (infoMessage) {
          setPostAuthMessage(infoMessage);
          setPostAuthMessageType(infoMessageType);
          // Brief pause so the message is actually readable before the
          // router.push() below carries the user away from this screen.
          await new Promise((r) => setTimeout(r, 1800));
        }
      }

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

      // The iph_user cookie is now set (finalize-login's Set-Cookie header
      // already applied by the time this fetch resolves). router.push()
      // below is a client-side transition -- it does NOT remount the root
      // layout (login and profile share it), so components mounted before
      // login (AttendeeProvider, in particular) would otherwise never know
      // the cookie changed. See hooks/useAuth.js's matching listener.
      window.dispatchEvent(new Event('iph-auth-changed'));

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
    [quickMode, fromPath, router, referralCode, isEmail]
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
          setLoading(false);
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
          setLoading(false);
          return;
        }

        if (result?.status !== 'success') {
          hapticError();
          setError(result?.message || (isEmail ? "Incorrect code" : "کد وارد شده اشتباه است"));
          setLoading(false);
          return;
        }

        // Success -- finalizeSession() ends with an un-awaited router.push(),
        // which only SCHEDULES the navigation, not waits for it. Resetting
        // loading here (as a blanket finally used to) re-renders this same
        // still-mounted step's UI -- e.g. step 3's "no account found, fill
        // in details" text -- for whatever window remains before the real
        // page swap completes. Leave loading=true; this component is being
        // navigated away from regardless, so there's nothing to reset for.
        await finalizeSession(result);
      } catch {
        hapticError();
        setError(t(lang, "server_error"));
        setLoading(false);
      } finally {
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
    // English-mode registrants have no second contact channel to fill in --
    // foreign visitors typically have no Iranian mobile number, so the
    // Mobile field is removed entirely for isEmail (see the JSX above);
    // nothing left to validate here.
    const otherOk = isEmail
      ? true
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileForm.otherContact);
    const activitiesOk =
      formOptions.fieldOfActivities.length === 0 || profileForm.fieldOfActivities.length > 0;
    return Boolean(nameOk && otherOk && profileForm.occupationId && activitiesOk && !invalidProfileNameFields.size);
  }

  async function handleRegisterSubmit(e) {
    e.preventDefault();
    if (invalidProfileNameFields.size) {
      setError(nameScriptError([...invalidProfileNameFields][0], isEmail));
      return;
    }
    if (!isProfileValid()) return;
    setError("");
    setLoading(true);
    try {
      const client = getApolloClient();
      const variables = {
        // Keep each language in its own field. The GraphQL schema requires
        // Persian strings, but an empty string is valid for email-only
        // registrations; copying an English name into those fields would
        // violate the profile name-script rule.
        firstnameFa: profileForm.firstnameFa,
        lastnameFa: profileForm.lastnameFa,
        firstnameEn: profileForm.firstnameEn,
        lastnameEn: profileForm.lastnameEn,
        // No otherContact collected for isEmail (Mobile field removed above)
        // -- $mobile is nullable on this mutation, and Apollo strips
        // undefined variables from the request rather than sending "".
        mobile: isEmail ? undefined : contact,
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
        setLoading(false);
        return;
      }

      const raw = data?.attendeeRegister;
      const result = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (result?.status !== 'success') {
        hapticError();
        setError(result?.message || (isEmail ? "Failed to create account" : "خطا در ایجاد حساب"));
        setLoading(false);
        return;
      }

      // Success -- finalizeSession() ends with an un-awaited router.push(),
      // which only SCHEDULES the navigation, not waits for it. Resetting
      // loading here (as a blanket finally used to) re-renders this same
      // still-mounted step 3 -- including its "no account found, fill in
      // details" intro text -- for whatever window remains before the real
      // page swap completes (confirmed 2026-09-14: this was the actual
      // source of the "یافت نشد" flash bug report -- not a new/separate
      // error, just this step's own always-there subtitle reappearing).
      // Leave loading=true; this component is being navigated away from
      // regardless, so there's nothing to reset for.
      await finalizeSession(result);
    } catch {
      hapticError();
      setError(t(lang, "server_error"));
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
      className="min-h-dvh flex items-center justify-center px-4"
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
        <div className="text-center mb-4">
          {(() => {
            // Fixed height, width auto -- same technique AppHeader.js's Logo
            // uses (h-8 w-auto object-contain) for its non-square logo+wordmark
            // lockup: one controlled dimension, the other derived from the
            // image's own aspect ratio, so a rectangular logo isn't squashed
            // or letterboxed into a forced square.
            const height = parseInt(settings.logo_height ?? "80", 10) || 80;
            return (
              <div className="mx-auto mb-11 flex items-center justify-center">
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
            {quickMode
              ? (isEmail ? "Enter the verification code to continue" : "برای ادامه کد تأیید را وارد کنید")
              : (isEmail ? (settings.subtitle_en || t(lang, "login_subtitle")) : (settings.subtitle || t(lang, "login_subtitle")))}
          </h1>
        </div>

        {/* Card */}
        <div
          className="backdrop-blur-xl border border-[var(--border-accent)] rounded-3xl p-6"
          style={{ background: "var(--surface)" }}
        >
          {postAuthMessage && (
            <p
              className="mb-3 text-xs text-center leading-5"
              style={{ color: postAuthMessageType === "warning" ? "#ff6b6b" : "var(--accent)" }}
            >
              {postAuthMessage}
            </p>
          )}
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
                  value={isRTL ? toPersianDigits(contact) : contact}
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

              {/* کد معرف (referral code) -- only shown when an active
                  referral_code mission exists for this event AND this isn't
                  the quickMode deep-link path (which skips step 1's UI
                  entirely and never gets referral-code capability). */}
              {referralCodeAvailable && !quickMode && (
                <div className="mt-2 text-center">
                  {referralCode ? (
                    <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>
                      {isEmail ? "✓ Referral code: " : "✓ کد معرف: "}
                      <span dir="ltr">{referralCode}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setShowReferralModal(true);
                        // Always open the modal -- but if contact is still
                        // empty, surface that immediately in the modal's own
                        // message slot instead of silently doing nothing
                        // (see 2026-09-16 فرخ ده بزرگی report).
                        setReferralModalError(contact.trim() ? "" : referralContactMissingMessage);
                      }}
                      className="text-xs"
                      style={{ color: "var(--accent)" }}
                    >
                      {isEmail ? "I have a referral code" : "کد معرف دارم"}
                    </button>
                  )}
                </div>
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
              <div className="mb-4 flex flex-wrap items-baseline justify-center gap-1">
                <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                  {isEmail ? (settings.otp_subtitle_en || t(lang, "otp_subtitle")) : settings.otp_subtitle}
                </p>
                <p className="text-sm font-bold" style={{ color: "var(--text)", direction: "ltr" }}>
                  {isEmail ? contact : toPersianDigits(contact)}
                </p>
              </div>

              <div dir="ltr" className="flex gap-2 justify-center">
                {otpDigits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => (otpRefs.current[index] = el)}
                    type="text"
                    inputMode="numeric"
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    maxLength={1}
                    value={isRTL ? toPersianDigits(digit) : digit}
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

              <div className="mt-4 flex items-center justify-between">
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
                        lang="en"
                        dir="ltr"
                        type="text"
                        value={profileForm.firstnameEn}
                        onChange={(e) => setProfileField("firstnameEn", e.target.value)}
                        aria-invalid={invalidProfileNameFields.has("firstnameEn")}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="First name"
                        autoComplete="given-name"
                      />
                      {invalidProfileNameFields.has("firstnameEn") && <p className="mt-1 text-xs" role="alert" style={{ color: "#ff6b6b" }}>{nameScriptError("firstnameEn", isEmail)}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        Last Name<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        lang="en"
                        dir="ltr"
                        type="text"
                        value={profileForm.lastnameEn}
                        onChange={(e) => setProfileField("lastnameEn", e.target.value)}
                        aria-invalid={invalidProfileNameFields.has("lastnameEn")}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="Last name"
                        autoComplete="family-name"
                      />
                      {invalidProfileNameFields.has("lastnameEn") && <p className="mt-1 text-xs" role="alert" style={{ color: "#ff6b6b" }}>{nameScriptError("lastnameEn", isEmail)}</p>}
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        نام<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        lang="fa"
                        dir="rtl"
                        type="text"
                        value={profileForm.firstnameFa}
                        onChange={(e) => setProfileField("firstnameFa", e.target.value)}
                        aria-invalid={invalidProfileNameFields.has("firstnameFa")}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="نام"
                        autoComplete="given-name"
                      />
                      {invalidProfileNameFields.has("firstnameFa") && <p className="mt-1 text-xs" role="alert" style={{ color: "#ff6b6b" }}>{nameScriptError("firstnameFa", isEmail)}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        نام خانوادگی<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        lang="fa"
                        dir="rtl"
                        type="text"
                        value={profileForm.lastnameFa}
                        onChange={(e) => setProfileField("lastnameFa", e.target.value)}
                        aria-invalid={invalidProfileNameFields.has("lastnameFa")}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="نام خانوادگی"
                        autoComplete="family-name"
                      />
                      {invalidProfileNameFields.has("lastnameFa") && <p className="mt-1 text-xs" role="alert" style={{ color: "#ff6b6b" }}>{nameScriptError("lastnameFa", isEmail)}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        نام انگلیسی<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        lang="en"
                        dir="ltr"
                        type="text"
                        value={profileForm.firstnameEn}
                        onChange={(e) => setProfileField("firstnameEn", e.target.value)}
                        aria-invalid={invalidProfileNameFields.has("firstnameEn")}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="First name (Latin)"
                        autoComplete="given-name"
                      />
                      {invalidProfileNameFields.has("firstnameEn") && <p className="mt-1 text-xs" role="alert" style={{ color: "#ff6b6b" }}>{nameScriptError("firstnameEn", isEmail)}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
                        نام خانوادگی انگلیسی<span style={{ color: "var(--accent)" }}> *</span>
                      </label>
                      <input
                        lang="en"
                        dir="ltr"
                        type="text"
                        value={profileForm.lastnameEn}
                        onChange={(e) => setProfileField("lastnameEn", e.target.value)}
                        aria-invalid={invalidProfileNameFields.has("lastnameEn")}
                        className="w-full rounded-xl px-4 py-3 text-base outline-none border"
                        style={FIELD_STYLE}
                        onFocus={focusAccentBorder}
                        onBlur={blurDefaultBorder}
                        placeholder="Last name (Latin)"
                        autoComplete="family-name"
                      />
                      {invalidProfileNameFields.has("lastnameEn") && <p className="mt-1 text-xs" role="alert" style={{ color: "#ff6b6b" }}>{nameScriptError("lastnameEn", isEmail)}</p>}
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

      {showReferralModal && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center px-4"
          dir={dir}
        >
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => { setShowReferralModal(false); setReferralModalError(""); }}
          />
          <div
            className="relative w-full max-w-sm rounded-3xl border border-[var(--border-accent)] p-6"
            style={{ background: "var(--surface)" }}
          >
            <h3 className="font-bold text-sm mb-4 text-center" style={{ color: "var(--text)" }}>
              {isEmail ? "Referral Code" : "کد معرف"}
            </h3>
            <input
              type="text"
              dir="ltr"
              value={referralInput}
              onChange={(e) => setReferralInput(e.target.value.toUpperCase().slice(0, 16))}
              placeholder={isEmail ? "Enter referral code" : "کد معرف را وارد کنید"}
              className="w-full rounded-xl px-4 py-3 text-base outline-none border transition-colors text-center tracking-widest"
              style={{
                background: "var(--surface-2)",
                color: "var(--text)",
                borderColor: "var(--border)",
              }}
              onFocus={focusAccentBorder}
              onBlur={blurDefaultBorder}
            />
            {referralModalError && (
              <p className="mt-3 text-sm text-center" style={{ color: "#ff6b6b" }}>
                {referralModalError}
              </p>
            )}
            <Button
              type="button"
              onClick={handleValidateReferralCode}
              disabled={referralChecking || !referralInput.trim()}
              variant="primary"
              className="w-full mt-4"
              size="lg"
            >
              {referralChecking
                ? (isEmail ? "Checking..." : "در حال بررسی...")
                : (isEmail ? "Confirm" : "تأیید")}
            </Button>
            <button
              type="button"
              onClick={() => { setShowReferralModal(false); setReferralModalError(""); }}
              className="w-full mt-3 text-xs"
              style={{ color: "var(--text-dim)" }}
            >
              {isEmail ? "Cancel" : "انصراف"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
