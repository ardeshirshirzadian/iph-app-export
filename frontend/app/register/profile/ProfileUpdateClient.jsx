"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import BottomNav from "@/app/components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/lib/useLang";
import { toPersianDigits, toEnglishDigits } from "@/lib/utils";

const ATTENDEE_QUERY = gql`
  query GetAttendee($id: Int!) {
    attendee(id: $id) {
      firstname_en lastname_en national_code email profile phone
      occupation_id education_level_id field_of_activities job_title_en
    }
  }
`;

const FORM_OPTIONS_QUERY = gql`
  {
    occupations(industryId: 1) { id title_fa title_en }
    fieldOfActivities(industryId: 1) { id title_fa title_en }
    educationLevels { id title_fa title_en }
  }
`;

const UPDATE_INFO = gql`
  mutation UpdateInfo(
    $firstnameFa: String! $lastnameFa: String!
    $firstnameEn: String! $lastnameEn: String!
    $jobTitleFa: String $jobTitleEn: String $nationalCode: String
  ) {
    attendeeUpdateProfileInfo(
      firstnameFa: $firstnameFa lastnameFa: $lastnameFa
      firstnameEn: $firstnameEn lastnameEn: $lastnameEn
      jobTitleFa: $jobTitleFa jobTitleEn: $jobTitleEn nationalCode: $nationalCode
    )
  }
`;

const UPDATE_CONTACT = gql`
  mutation UpdateContact($email: String $phone: String) {
    attendeeUpdateProfileContact(email: $email phone: $phone)
  }
`;

const UPDATE_ACTIVITY = gql`
  mutation UpdateActivity(
    $occupationId: Int $fieldOfActivities: [Int!]! $educationLevelId: Int
  ) {
    attendeeUpdateProfileActivity(
      industryId: 1
      occupationId: $occupationId
      fieldOfActivities: $fieldOfActivities
      educationLevelId: $educationLevelId
    )
  }
`;

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

export default function ProfileUpdateClient() {
  const { user } = useAuth();
  const router = useRouter();
  const { lang, isRTL } = useLang();
  const isEN = lang === "en";

  const [form, setForm] = useState({
    firstnameFa: "", lastnameFa: "", firstnameEn: "", lastnameEn: "",
    jobTitleFa: "", jobTitleEn: "", nationalCode: "",
    email: "", phone: "",
    occupationId: "", fieldOfActivities: [], educationLevelId: "",
  });
  const [formOptions, setFormOptions] = useState({ occupations: [], fieldOfActivities: [], educationLevels: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Pre-fill from user cookie
  useEffect(() => {
    if (!user) return;
    setForm((prev) => ({
      ...prev,
      firstnameFa: user.firstname_fa || "",
      lastnameFa:  user.lastname_fa  || "",
      firstnameEn: user.firstname_en || "",
      lastnameEn:  user.lastname_en  || "",
      jobTitleFa:  user.job_title_fa || "",
      email:       user.email        || "",
    }));
  }, [user]);

  // Load form options + extended profile via Apollo
  useEffect(() => {
    const client = getApolloClient();

    client.query({ query: FORM_OPTIONS_QUERY })
      .then(({ data }) => setFormOptions({
        occupations: data?.occupations ?? [],
        fieldOfActivities: data?.fieldOfActivities ?? [],
        educationLevels: data?.educationLevels ?? [],
      }))
      .catch(() => {})
      .finally(() => setOptionsLoading(false));

    if (user?.id) {
      client.query({ query: ATTENDEE_QUERY, variables: { id: Number(user.id) } })
        .then(({ data }) => {
          const a = data?.attendee;
          if (!a) return;
          setForm((prev) => ({
            ...prev,
            firstnameEn:    prev.firstnameEn    || a.firstname_en    || "",
            lastnameEn:     prev.lastnameEn     || a.lastname_en     || "",
            jobTitleEn:     prev.jobTitleEn     || a.job_title_en    || "",
            nationalCode:   prev.nationalCode   || a.national_code   || "",
            email:          prev.email          || a.email           || "",
            phone:          prev.phone          || a.phone           || "",
            occupationId:   prev.occupationId   || String(a.occupation_id   ?? ""),
            educationLevelId: prev.educationLevelId || String(a.education_level_id ?? ""),
            fieldOfActivities: prev.fieldOfActivities.length
              ? prev.fieldOfActivities
              : (a.field_of_activities ?? []),
          }));
        })
        .catch(() => {});
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function handleSave() {
    setSubmitting(true);
    setError("");
    try {
      const client = getApolloClient();

      // 1. Personal info (required)
      const { errors: infoErrors } = await client.mutate({
        mutation: UPDATE_INFO,
        variables: {
          firstnameFa: form.firstnameFa,
          lastnameFa: form.lastnameFa,
          firstnameEn: form.firstnameEn || user?.firstname_en || "",
          lastnameEn: form.lastnameEn || user?.lastname_en || "",
          jobTitleFa: form.jobTitleFa || undefined,
          jobTitleEn: form.jobTitleEn || undefined,
          nationalCode: form.nationalCode || undefined,
        },
      });
      if (infoErrors?.length) throw new Error(infoErrors[0].message || "خطا در ذخیره اطلاعات");

      // 2. Contact (non-fatal)
      if (form.email || form.phone) {
        await client.mutate({
          mutation: UPDATE_CONTACT,
          variables: { email: form.email || undefined, phone: form.phone || undefined },
        }).catch(() => {});
      }

      // 3. Activity (non-fatal)
      const hasActivity = form.occupationId || form.fieldOfActivities.length || form.educationLevelId;
      if (hasActivity) {
        await client.mutate({
          mutation: UPDATE_ACTIVITY,
          variables: {
            occupationId: form.occupationId ? parseInt(form.occupationId) : undefined,
            fieldOfActivities: form.fieldOfActivities.map(Number).filter(Boolean),
            educationLevelId: form.educationLevelId ? parseInt(form.educationLevelId) : undefined,
          },
        }).catch(() => {});
      }

      router.push("/register/confirm");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const dir = isRTL ? "rtl" : "ltr";

  return (
    <div
      className="min-h-screen pb-28"
      style={{ background: "var(--bg)" }}
      dir={dir}
      lang={lang}
    >
      <div className="fixed top-0 right-0 w-72 h-72 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(0,255,179,0.04)", zIndex: 0 }} />
      <div className="fixed bottom-0 left-0 w-80 h-80 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(5,64,65,0.5)", zIndex: 0 }} />

      <div className="relative z-10 max-w-lg mx-auto px-4 pt-4">
        <PageHeader
          title="تکمیل اطلاعات"
          title_en="Complete Your Profile"
          subtitle="قبل از ثبت‌نام، اطلاعات خود را تکمیل کنید"
          subtitle_en="Please complete your profile before registering"
          showBack
        />

        <div className="flex flex-col gap-4">
          {/* FA/EN info tabs */}
          <div
            className="flex rounded-xl overflow-hidden border"
            style={{ borderColor: "var(--border)" }}
          >
            <button
              type="button"
              onClick={() => {}}
              className="flex-1 py-2 text-sm font-bold"
              style={{ background: !isEN ? "var(--accent)" : "transparent", color: !isEN ? "#021f20" : "var(--text-dim)" }}
            >
              FA فارسی
            </button>
            <button
              type="button"
              onClick={() => {}}
              className="flex-1 py-2 text-sm font-bold"
              style={{ background: isEN ? "var(--accent)" : "transparent", color: isEN ? "#021f20" : "var(--text-dim)" }}
            >
              EN English
            </button>
          </div>

          {/* Personal info */}
          <SectionCard title={isEN ? "Personal Information" : "اطلاعات شخصی"}>
            {isEN ? (
              <>
                <Field label="First Name" required>
                  <input dir="ltr" type="text" value={form.firstnameEn}
                    onChange={(e) => set("firstnameEn", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label="Last Name" required>
                  <input dir="ltr" type="text" value={form.lastnameEn}
                    onChange={(e) => set("lastnameEn", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label="Job Title">
                  <input dir="ltr" type="text" value={form.jobTitleEn}
                    onChange={(e) => set("jobTitleEn", e.target.value)} style={INPUT_STYLE} />
                </Field>
              </>
            ) : (
              <>
                <Field label="نام" required>
                  <input dir="rtl" type="text" value={form.firstnameFa}
                    onChange={(e) => set("firstnameFa", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label="نام خانوادگی" required>
                  <input dir="rtl" type="text" value={form.lastnameFa}
                    onChange={(e) => set("lastnameFa", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label="نام انگلیسی">
                  <input dir="ltr" type="text" value={form.firstnameEn}
                    onChange={(e) => set("firstnameEn", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label="نام خانوادگی انگلیسی">
                  <input dir="ltr" type="text" value={form.lastnameEn}
                    onChange={(e) => set("lastnameEn", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label="سمت شغلی">
                  <input dir="rtl" type="text" value={form.jobTitleFa}
                    onChange={(e) => set("jobTitleFa", e.target.value)} style={INPUT_STYLE} />
                </Field>
                <Field label="کد ملی">
                  <input
                    dir="ltr" type="text" inputMode="numeric"
                    value={isRTL ? toPersianDigits(form.nationalCode) : form.nationalCode}
                    onChange={(e) => set("nationalCode", toEnglishDigits(e.target.value).replace(/\D/g, "").slice(0, 10))}
                    style={{ ...INPUT_STYLE, textAlign: "center" }}
                    maxLength={10}
                  />
                </Field>
              </>
            )}
          </SectionCard>

          {/* Contact */}
          <SectionCard title={isEN ? "Contact" : "اطلاعات تماس"}>
            <Field label={isEN ? "Email" : "ایمیل"}>
              <input dir="ltr" type="email" inputMode="email" value={form.email}
                onChange={(e) => set("email", e.target.value.trim())} style={INPUT_STYLE} />
            </Field>
            {!isEN && (
              <Field label="تلفن ثابت">
                <input dir="ltr" type="text" inputMode="tel"
                  value={isRTL ? toPersianDigits(form.phone) : form.phone}
                  onChange={(e) => set("phone", toEnglishDigits(e.target.value).replace(/\D/g, ""))}
                  style={INPUT_STYLE} />
              </Field>
            )}
          </SectionCard>

          {/* Activity */}
          <SectionCard title={isEN ? "Field of Activity" : "حوزه فعالیت"}>
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
          </SectionCard>

          {error && (
            <p className="text-xs px-1" style={{ color: "#ef4444" }}>{error}</p>
          )}

          <button
            onClick={handleSave}
            disabled={submitting}
            className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#021f20" }}
          >
            {submitting
              ? (isEN ? "Saving..." : "در حال ذخیره...")
              : (isEN ? "Save & Continue" : "ذخیره و ادامه")}
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
