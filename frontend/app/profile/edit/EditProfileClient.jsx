"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import BottomNav from "@/app/components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import { toPersianDigits, toEnglishDigits } from "@/lib/utils";
import { handleApiResponse } from "@/lib/handleApiResponse";

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

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-dim)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div
      className="rounded-3xl p-5 backdrop-blur-xl border space-y-4"
      style={{ background: "var(--surface)", borderColor: "var(--border-accent)" }}
    >
      <p className="text-xs font-bold" style={{ color: "var(--text-dim)" }}>{title}</p>
      {children}
    </div>
  );
}

function SaveButton({ onClick, saving, saved }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
      style={{
        background: saved ? "rgba(34,197,94,0.15)" : "var(--accent)",
        color: saved ? "#22c55e" : "#021f20",
        border: saved ? "1px solid rgba(34,197,94,0.3)" : "none",
      }}
    >
      {saving ? "..." : saved ? t('fa', 'edit_saved') : null}
      {!saving && !saved ? null : null}
      {saving ? "..." : saved ? "ذخیره شد ✓" : "ذخیره"}
    </button>
  );
}

export default function EditProfileClient() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { lang, isRTL } = useLang();
  const isEN = lang === "en";

  const [editLang, setEditLang] = useState(isEN ? "en" : "fa");

  const [form, setForm] = useState({
    firstnameFa: "", lastnameFa: "", firstnameEn: "", lastnameEn: "",
    jobTitleFa: "", jobTitleEn: "", nationalCode: "",
    email: "", phone: "",
    occupationId: "", fieldOfActivities: [], educationLevelId: "",
  });

  const [formOptions, setFormOptions] = useState({ occupations: [], fieldOfActivities: [], educationLevels: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);

  // Per-section save state: { saving, saved, error }
  const [infoState,     setInfoState]     = useState({ saving: false, saved: false, error: "" });
  const [contactState,  setContactState]  = useState({ saving: false, saved: false, error: "" });
  const [activityState, setActivityState] = useState({ saving: false, saved: false, error: "" });

  // Pre-fill from user cookie immediately
  useEffect(() => {
    if (!user) return;
    setForm((prev) => ({
      ...prev,
      firstnameFa: prev.firstnameFa || user.firstname_fa || "",
      lastnameFa:  prev.lastnameFa  || user.lastname_fa  || "",
      firstnameEn: prev.firstnameEn || user.firstname_en || "",
      lastnameEn:  prev.lastnameEn  || user.lastname_en  || "",
      jobTitleFa:  prev.jobTitleFa  || user.job_title_fa || "",
      email:       prev.email       || user.email        || "",
    }));
  }, [user]);

  // Load profile API data
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const a = data?.attendee;
        if (!a) return;
        setForm((prev) => ({
          ...prev,
          firstnameEn:      prev.firstnameEn    || a.firstname_en    || "",
          lastnameEn:       prev.lastnameEn     || a.lastname_en     || "",
          jobTitleEn:       prev.jobTitleEn     || a.job_title_en    || "",
          nationalCode:     prev.nationalCode   || a.national_code   || "",
          email:            prev.email          || a.email           || "",
          phone:            prev.phone          || a.phone           || "",
          occupationId:     prev.occupationId   || String(a.occupation_id      ?? ""),
          educationLevelId: prev.educationLevelId || String(a.education_level_id ?? ""),
          fieldOfActivities: prev.fieldOfActivities.length
            ? prev.fieldOfActivities
            : (a.field_of_activities ?? []),
        }));
      })
      .catch(() => {});
  }, []);

  // Load dropdown options
  useEffect(() => {
    fetch("/api/registration/form-data")
      .then((r) => r.json())
      .then((data) => setFormOptions(data))
      .catch(() => {})
      .finally(() => setOptionsLoading(false));
  }, []);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleActivity(id) {
    setForm((prev) => {
      const next = prev.fieldOfActivities.includes(id)
        ? prev.fieldOfActivities.filter((x) => x !== id)
        : [...prev.fieldOfActivities, id];
      return { ...prev, fieldOfActivities: next };
    });
  }

  async function saveInfo() {
    setInfoState({ saving: true, saved: false, error: "" });
    try {
      const res = await fetch("/api/user/update-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstnameFa: form.firstnameFa, lastnameFa: form.lastnameFa,
          firstnameEn: form.firstnameEn, lastnameEn: form.lastnameEn,
          jobTitleFa: form.jobTitleFa, jobTitleEn: form.jobTitleEn,
          nationalCode: form.nationalCode,
        }),
      });
      const result = await handleApiResponse(res, router, pathname);
      if (result.sessionExpired || result.notLoggedIn) { setInfoState({ saving: false, saved: false, error: "" }); return; }
      if (!res.ok) throw new Error(result.data?.error || "خطا در ذخیره‌سازی");
      setInfoState({ saving: false, saved: true, error: "" });
      setTimeout(() => router.push("/profile"), 1500);
    } catch (err) {
      setInfoState({ saving: false, saved: false, error: err.message });
    }
  }

  async function saveContact() {
    setContactState({ saving: true, saved: false, error: "" });
    try {
      const res = await fetch("/api/user/update-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, phone: form.phone }),
      });
      const result = await handleApiResponse(res, router, pathname);
      if (result.sessionExpired || result.notLoggedIn) { setContactState({ saving: false, saved: false, error: "" }); return; }
      if (!res.ok) throw new Error(result.data?.error || "خطا در ذخیره‌سازی");
      setContactState({ saving: false, saved: true, error: "" });
      setTimeout(() => router.push("/profile"), 1500);
    } catch (err) {
      setContactState({ saving: false, saved: false, error: err.message });
    }
  }

  async function saveActivity() {
    setActivityState({ saving: true, saved: false, error: "" });
    try {
      const res = await fetch("/api/user/update-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occupationId: form.occupationId ? parseInt(form.occupationId) : null,
          fieldOfActivities: form.fieldOfActivities,
          educationLevelId: form.educationLevelId ? parseInt(form.educationLevelId) : null,
        }),
      });
      const result = await handleApiResponse(res, router, pathname);
      if (result.sessionExpired || result.notLoggedIn) { setActivityState({ saving: false, saved: false, error: "" }); return; }
      if (!res.ok) throw new Error(result.data?.error || "خطا در ذخیره‌سازی");
      setActivityState({ saving: false, saved: true, error: "" });
      setTimeout(() => router.push("/profile"), 1500);
    } catch (err) {
      setActivityState({ saving: false, saved: false, error: err.message });
    }
  }

  const dir = isRTL ? "rtl" : "ltr";

  return (
    <main
      dir={dir}
      lang={lang}
      className="min-h-screen"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md mx-auto px-4 pb-32">
        <PageHeader
          title={t(lang, "edit_profile")}
          title_en="Edit Profile"
          showBack
        />

        <div className="flex flex-col gap-4">
          {/* FA / EN toggle */}
          <div
            className="flex rounded-xl overflow-hidden border"
            style={{ borderColor: "var(--border)" }}
          >
            <button
              type="button"
              onClick={() => setEditLang("fa")}
              className="flex-1 py-2 text-sm font-bold transition-colors"
              style={{
                background: editLang === "fa" ? "var(--accent)" : "transparent",
                color: editLang === "fa" ? "#021f20" : "var(--text-muted)",
              }}
            >
              FA فارسی
            </button>
            <button
              type="button"
              onClick={() => setEditLang("en")}
              className="flex-1 py-2 text-sm font-bold transition-colors"
              style={{
                background: editLang === "en" ? "var(--accent)" : "transparent",
                color: editLang === "en" ? "#021f20" : "var(--text-muted)",
              }}
            >
              EN English
            </button>
          </div>

          {/* ── Card 1: Personal info ── */}
          <Card title={editLang === "fa" ? t(lang, "edit_info_fa") : t(lang, "edit_info_en")}>
            {editLang === "fa" ? (
              <>
                <Field label={t(lang, "edit_firstname")}>
                  <input dir="rtl" type="text" value={form.firstnameFa}
                    onChange={(e) => set("firstnameFa", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label={t(lang, "edit_lastname")}>
                  <input dir="rtl" type="text" value={form.lastnameFa}
                    onChange={(e) => set("lastnameFa", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label={t(lang, "edit_job_title")}>
                  <input dir="rtl" type="text" value={form.jobTitleFa}
                    onChange={(e) => set("jobTitleFa", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label={t(lang, "edit_national_id")}>
                  <input
                    dir="ltr" type="text" inputMode="numeric"
                    value={isRTL ? toPersianDigits(form.nationalCode) : form.nationalCode}
                    onChange={(e) => set("nationalCode", toEnglishDigits(e.target.value).replace(/\D/g, "").slice(0, 10))}
                    style={{ ...INPUT_STYLE, textAlign: "center", letterSpacing: 2 }}
                    maxLength={10}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label={t(lang, "edit_firstname")}>
                  <input dir="ltr" type="text" value={form.firstnameEn}
                    onChange={(e) => set("firstnameEn", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label={t(lang, "edit_lastname")}>
                  <input dir="ltr" type="text" value={form.lastnameEn}
                    onChange={(e) => set("lastnameEn", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label={t(lang, "edit_job_title")}>
                  <input dir="ltr" type="text" value={form.jobTitleEn}
                    onChange={(e) => set("jobTitleEn", e.target.value)} style={INPUT_STYLE} />
                </Field>
              </>
            )}

            {infoState.error && (
              <p className="text-xs" style={{ color: "#ef4444" }}>{infoState.error}</p>
            )}
            <button
              type="button"
              onClick={saveInfo}
              disabled={infoState.saving}
              className="w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
              style={{
                background: infoState.saved ? "rgba(34,197,94,0.12)" : "var(--accent)",
                color: infoState.saved ? "#22c55e" : "#021f20",
                border: infoState.saved ? "1px solid rgba(34,197,94,0.25)" : "none",
              }}
            >
              {infoState.saving ? "..." : infoState.saved ? "ذخیره شد ✓" : t(lang, "edit_save_info")}
            </button>
          </Card>

          {/* ── Card 2: Contact ── */}
          <Card title={t(lang, "edit_contact_section")}>
            <Field label={t(lang, "edit_email")}>
              <input dir="ltr" type="email" inputMode="email" value={form.email}
                onChange={(e) => set("email", e.target.value.trim())} style={INPUT_STYLE} />
            </Field>
            <Field label={t(lang, "edit_phone")}>
              <input
                dir="ltr" type="text" inputMode="tel"
                value={isRTL ? toPersianDigits(form.phone) : form.phone}
                onChange={(e) => set("phone", toEnglishDigits(e.target.value).replace(/\D/g, ""))}
                style={INPUT_STYLE}
              />
            </Field>

            {contactState.error && (
              <p className="text-xs" style={{ color: "#ef4444" }}>{contactState.error}</p>
            )}
            <button
              type="button"
              onClick={saveContact}
              disabled={contactState.saving}
              className="w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
              style={{
                background: contactState.saved ? "rgba(34,197,94,0.12)" : "var(--accent)",
                color: contactState.saved ? "#22c55e" : "#021f20",
                border: contactState.saved ? "1px solid rgba(34,197,94,0.25)" : "none",
              }}
            >
              {contactState.saving ? "..." : contactState.saved ? "ذخیره شد ✓" : t(lang, "edit_save_contact")}
            </button>
          </Card>

          {/* ── Card 3: Field of Activity ── */}
          <Card title={isEN ? "Field of Activity" : "حوزه فعالیت"}>
            {optionsLoading ? (
              <p className="text-xs text-center py-2" style={{ color: "var(--text-dim)" }}>
                {isEN ? "Loading..." : "در حال بارگذاری..."}
              </p>
            ) : (
              <>
                {formOptions.occupations.length > 0 && (
                  <Field label={isEN ? "Occupation" : "شغل"}>
                    <select
                      value={form.occupationId}
                      onChange={(e) => set("occupationId", e.target.value)}
                      style={{ ...SELECT_STYLE, direction: dir }}
                    >
                      <option value="">{isEN ? "Select..." : "انتخاب کنید..."}</option>
                      {formOptions.occupations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {isEN ? (o.title_en || o.title_fa) : (o.title_fa || o.title_en)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                {formOptions.fieldOfActivities.length > 0 && (
                  <Field label={isEN ? "Field of Activity" : "حوزه فعالیت"}>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {formOptions.fieldOfActivities.map((f) => {
                        const isActive = form.fieldOfActivities.includes(f.id);
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => toggleActivity(f.id)}
                            className="text-xs px-3 py-1.5 rounded-full border transition-all"
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

                {formOptions.educationLevels.length > 0 && (
                  <Field label={isEN ? "Education Level" : "مدرک تحصیلی"}>
                    <select
                      value={form.educationLevelId}
                      onChange={(e) => set("educationLevelId", e.target.value)}
                      style={{ ...SELECT_STYLE, direction: dir }}
                    >
                      <option value="">{isEN ? "Select..." : "انتخاب کنید..."}</option>
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

            {activityState.error && (
              <p className="text-xs" style={{ color: "#ef4444" }}>{activityState.error}</p>
            )}
            <button
              type="button"
              onClick={saveActivity}
              disabled={activityState.saving}
              className="w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
              style={{
                background: activityState.saved ? "rgba(34,197,94,0.12)" : "var(--accent)",
                color: activityState.saved ? "#22c55e" : "#021f20",
                border: activityState.saved ? "1px solid rgba(34,197,94,0.25)" : "none",
              }}
            >
              {activityState.saving ? "..." : activityState.saved ? "ذخیره شد ✓" : (isEN ? "Save Activity" : "ذخیره حوزه فعالیت")}
            </button>
          </Card>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
