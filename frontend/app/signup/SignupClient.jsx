"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLang } from "@/lib/useLang";
import { toPersianDigits, toEnglishDigits } from "@/lib/utils";
import LangToggle from "@/components/LangToggle";

const INPUT_STYLE = {
  width: "100%",
  borderRadius: 8,
  padding: "9px 12px",
  background: "rgba(5,64,65,0.4)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 14,
  outline: "none",
};

const SELECT_STYLE = {
  ...INPUT_STYLE,
  appearance: "none",
  WebkitAppearance: "none",
  cursor: "pointer",
};

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
        {label}{required && <span style={{ color: "var(--accent)" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function SectionCard({ title, children }) {
  return (
    <div
      className="rounded-3xl p-5 backdrop-blur-xl border space-y-4"
      style={{ background: "rgba(5,64,65,0.4)", borderColor: "rgba(0,255,179,0.2)" }}
    >
      <p className="text-xs font-bold tracking-wide" style={{ color: "var(--text-dim)" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

export default function SignupClient() {
  const router = useRouter();
  const { lang, isRTL } = useLang();
  const isEN = lang === "en";

  const [formData, setFormData] = useState({
    firstnameFa: "", lastnameFa: "", firstnameEn: "", lastnameEn: "",
    jobTitleFa: "", jobTitleEn: "", nationalCode: "",
    mobile: "", email: "",
    occupationId: "", fieldOfActivities: [], educationLevelId: "",
  });
  const [formOptions, setFormOptions] = useState({
    occupations: [], fieldOfActivities: [], educationLevels: [],
  });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/registration/form-data")
      .then((r) => r.json())
      .then((data) => setFormOptions(data))
      .catch(() => {})
      .finally(() => setOptionsLoading(false));
  }, []);

  function set(field, value) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function toggleActivity(id) {
    setFormData((prev) => {
      const next = prev.fieldOfActivities.includes(id)
        ? prev.fieldOfActivities.filter((x) => x !== id)
        : [...prev.fieldOfActivities, id];
      return { ...prev, fieldOfActivities: next };
    });
  }

  function isValid() {
    if (isEN) {
      return formData.firstnameEn.trim() && formData.lastnameEn.trim() && formData.email.includes("@");
    }
    return formData.firstnameFa.trim() && formData.lastnameFa.trim() &&
           formData.nationalCode.trim() && formData.mobile.length === 11;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          occupationId: formData.occupationId ? parseInt(formData.occupationId) : null,
          educationLevelId: formData.educationLevelId ? parseInt(formData.educationLevelId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || (isEN ? "Failed to create account" : "خطا در ایجاد حساب"));
        return;
      }
      setSuccess(true);
      // Navigate to login with OTP step pre-filled
      setTimeout(() => {
        const contact = isEN ? formData.email : formData.mobile;
        const param = isEN ? `email=${encodeURIComponent(contact)}` : `mobile=${encodeURIComponent(contact)}`;
        router.push(`/login?verify=1&${param}`);
      }, 1500);
    } catch {
      setError(isEN ? "Server error, please try again" : "خطا در ارتباط با سرور");
    } finally {
      setSubmitting(false);
    }
  }

  const dir = isRTL ? "rtl" : "ltr";

  return (
    <main
      dir={dir}
      lang={lang}
      className="min-h-screen pb-12 px-4 pt-4"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      {/* Background glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between mb-6" dir="ltr">
        <Link
          href="/login"
          className="flex items-center justify-center rounded-xl transition-all active:scale-95"
          style={{
            width: 38, height: 38,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            fontSize: 20,
          }}
        >
          ‹
        </Link>
        <LangToggle />
      </div>

      <div className="relative z-10 max-w-sm mx-auto">
        {/* Title */}
        <div className="mb-6" dir={dir}>
          <h1 className="text-2xl font-black" style={{ color: "var(--text)" }}>
            {isEN ? "Create Account" : "ایجاد حساب کاربری"}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-dim)" }}>
            {isEN ? "Fill in your information to register" : "اطلاعات خود را برای ثبت‌نام وارد کنید"}
          </p>
        </div>

        {success ? (
          <div
            className="rounded-3xl p-8 text-center"
            style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}
          >
            <div style={{ fontSize: 48 }}>✅</div>
            <p className="text-base font-bold mt-4" style={{ color: "#22c55e" }}>
              {isEN ? "Account created successfully!" : "حساب کاربری با موفقیت ایجاد شد!"}
            </p>
            <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
              {isEN ? "Sending verification code..." : "در حال ارسال کد تأیید..."}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Card 1: Personal Info */}
            <SectionCard title={isEN ? "Personal Information" : "اطلاعات شخصی"}>
              {isEN ? (
                <>
                  <Field label="First Name" required>
                    <input
                      dir="ltr"
                      type="text"
                      value={formData.firstnameEn}
                      onChange={(e) => set("firstnameEn", e.target.value)}
                      style={INPUT_STYLE}
                      placeholder="First name"
                      autoComplete="given-name"
                    />
                  </Field>
                  <Field label="Last Name" required>
                    <input
                      dir="ltr"
                      type="text"
                      value={formData.lastnameEn}
                      onChange={(e) => set("lastnameEn", e.target.value)}
                      style={INPUT_STYLE}
                      placeholder="Last name"
                      autoComplete="family-name"
                    />
                  </Field>
                  <Field label="Persian First Name">
                    <input
                      dir="rtl"
                      type="text"
                      value={formData.firstnameFa}
                      onChange={(e) => set("firstnameFa", e.target.value)}
                      style={INPUT_STYLE}
                      placeholder="نام فارسی"
                    />
                  </Field>
                  <Field label="Persian Last Name">
                    <input
                      dir="rtl"
                      type="text"
                      value={formData.lastnameFa}
                      onChange={(e) => set("lastnameFa", e.target.value)}
                      style={INPUT_STYLE}
                      placeholder="نام خانوادگی فارسی"
                    />
                  </Field>
                  <Field label="Job Title">
                    <input
                      dir="ltr"
                      type="text"
                      value={formData.jobTitleEn}
                      onChange={(e) => set("jobTitleEn", e.target.value)}
                      style={INPUT_STYLE}
                      placeholder="e.g. Pharmacist"
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="نام" required>
                    <input
                      dir="rtl"
                      type="text"
                      value={formData.firstnameFa}
                      onChange={(e) => set("firstnameFa", e.target.value)}
                      style={INPUT_STYLE}
                      placeholder="نام"
                      autoComplete="given-name"
                    />
                  </Field>
                  <Field label="نام خانوادگی" required>
                    <input
                      dir="rtl"
                      type="text"
                      value={formData.lastnameFa}
                      onChange={(e) => set("lastnameFa", e.target.value)}
                      style={INPUT_STYLE}
                      placeholder="نام خانوادگی"
                      autoComplete="family-name"
                    />
                  </Field>
                  <Field label="نام انگلیسی">
                    <input
                      dir="ltr"
                      type="text"
                      value={formData.firstnameEn}
                      onChange={(e) => set("firstnameEn", e.target.value)}
                      style={INPUT_STYLE}
                      placeholder="First name"
                    />
                  </Field>
                  <Field label="نام خانوادگی انگلیسی">
                    <input
                      dir="ltr"
                      type="text"
                      value={formData.lastnameEn}
                      onChange={(e) => set("lastnameEn", e.target.value)}
                      style={INPUT_STYLE}
                      placeholder="Last name"
                    />
                  </Field>
                  <Field label="سمت شغلی">
                    <input
                      dir="rtl"
                      type="text"
                      value={formData.jobTitleFa}
                      onChange={(e) => set("jobTitleFa", e.target.value)}
                      style={INPUT_STYLE}
                      placeholder="مثلاً داروساز"
                    />
                  </Field>
                  <Field label="کد ملی" required>
                    <input
                      dir="ltr"
                      type="text"
                      inputMode="numeric"
                      value={isRTL ? toPersianDigits(formData.nationalCode) : formData.nationalCode}
                      onChange={(e) => set("nationalCode", toEnglishDigits(e.target.value).replace(/\D/g, "").slice(0, 10))}
                      style={{ ...INPUT_STYLE, textAlign: "center", letterSpacing: 2 }}
                      placeholder="__________"
                      maxLength={10}
                    />
                  </Field>
                </>
              )}
            </SectionCard>

            {/* Card 2: Contact Info */}
            <SectionCard title={isEN ? "Contact Information" : "اطلاعات تماس"}>
              {isEN ? (
                <Field label="Email" required>
                  <input
                    dir="ltr"
                    type="email"
                    inputMode="email"
                    value={formData.email}
                    onChange={(e) => set("email", e.target.value.trim())}
                    style={INPUT_STYLE}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </Field>
              ) : (
                <>
                  <Field label="شماره موبایل" required>
                    <input
                      dir="ltr"
                      type="tel"
                      inputMode="numeric"
                      value={toPersianDigits(formData.mobile)}
                      onChange={(e) => set("mobile", toEnglishDigits(e.target.value).replace(/\D/g, "").slice(0, 11))}
                      style={{ ...INPUT_STYLE, textAlign: "center", letterSpacing: 2 }}
                      placeholder="۰۹xxxxxxxxx"
                      maxLength={11}
                    />
                  </Field>
                  <Field label="ایمیل">
                    <input
                      dir="ltr"
                      type="email"
                      inputMode="email"
                      value={formData.email}
                      onChange={(e) => set("email", e.target.value.trim())}
                      style={INPUT_STYLE}
                      placeholder="you@example.com"
                    />
                  </Field>
                </>
              )}
            </SectionCard>

            {/* Card 3: Field of Activity */}
            <SectionCard title={isEN ? "Field of Activity" : "حوزه فعالیت"}>
              {optionsLoading ? (
                <p className="text-xs text-center py-2" style={{ color: "var(--text-dim)" }}>
                  {isEN ? "Loading..." : "در حال بارگذاری..."}
                </p>
              ) : (
                <>
                  {/* Occupation dropdown */}
                  <Field label={isEN ? "Occupation" : "شغل"} required>
                    <div className="relative">
                      <select
                        value={formData.occupationId}
                        onChange={(e) => set("occupationId", e.target.value)}
                        style={{ ...SELECT_STYLE, direction: dir }}
                      >
                        <option value="">
                          {isEN ? "Select occupation..." : "انتخاب کنید..."}
                        </option>
                        {formOptions.occupations.map((o) => (
                          <option key={o.id} value={o.id}>
                            {isEN ? (o.title_en || o.title_fa) : (o.title_fa || o.title_en)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </Field>

                  {/* Field of activities chips */}
                  {formOptions.fieldOfActivities.length > 0 && (
                    <Field label={isEN ? "Field of Activity" : "حوزه فعالیت"}>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {formOptions.fieldOfActivities.map((f) => {
                          const isActive = formData.fieldOfActivities.includes(f.id);
                          return (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => toggleActivity(f.id)}
                              className="text-xs px-3 py-1.5 rounded-full transition-all border"
                              style={{
                                background: isActive ? "var(--accent)" : "rgba(5,64,65,0.5)",
                                color: isActive ? "#021f20" : "rgba(255,255,255,0.6)",
                                borderColor: isActive ? "var(--accent)" : "rgba(255,255,255,0.1)",
                                fontWeight: isActive ? "700" : "400",
                              }}
                            >
                              {isEN ? (f.title_en || f.title_fa) : (f.title_fa || f.title_en)}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                  )}

                  {/* Education level */}
                  {formOptions.educationLevels.length > 0 && (
                    <Field label={isEN ? "Education Level" : "مدرک تحصیلی"}>
                      <select
                        value={formData.educationLevelId}
                        onChange={(e) => set("educationLevelId", e.target.value)}
                        style={{ ...SELECT_STYLE, direction: dir }}
                      >
                        <option value="">
                          {isEN ? "Select..." : "انتخاب کنید..."}
                        </option>
                        {formOptions.educationLevels.map((e) => (
                          <option key={e.id} value={e.id}>
                            {isEN ? (e.title_en || e.title_fa) : (e.title_fa || e.title_en)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </>
              )}
            </SectionCard>

            {error && (
              <p className="text-sm text-center px-2" style={{ color: "#ef4444" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !isValid()}
              className="w-full py-3.5 rounded-xl font-bold text-base transition-all active:scale-95 disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#021f20" }}
            >
              {submitting
                ? (isEN ? "Creating account..." : "در حال ایجاد حساب...")
                : (isEN ? "Create Account" : "ایجاد حساب")}
            </button>

            <p className="text-center text-sm" style={{ color: "var(--text-dim)" }}>
              {isEN ? "Already have an account? " : "حساب کاربری دارید؟ "}
              <Link href="/login" style={{ color: "var(--accent)", fontWeight: 700 }}>
                {isEN ? "Sign In" : "ورود"}
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
