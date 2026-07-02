"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import Cropper from "react-easy-crop";
import BottomNav from "@/app/components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import { toPersianDigits, toEnglishDigits } from "@/lib/utils";

const RASAYESH_BASE   = "https://api.rasayesh.com/";
const RASAYESH_GQL    = "https://api.rasayesh.com/graphql";
const RASAYESH_ORIGIN = "https://attendee.rasayesh.com";

// Canvas-based crop: returns a JPEG Blob of the cropped region
async function getCroppedImg(imageSrc, pixelCrop) {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  const canvas = document.createElement("canvas");
  canvas.width  = pixelCrop.width;
  canvas.height = pixelCrop.height;
  canvas.getContext("2d").drawImage(
    image,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, pixelCrop.width, pixelCrop.height,
  );
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}

// Multipart GraphQL upload (HttpLink doesn't support files, so raw fetch)
async function uploadProfileImage(blob, fields) {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const query = `mutation AttendeeUpdateProfileInfo(
    $firstnameFa: String, $lastnameFa: String,
    $firstnameEn: String, $lastnameEn: String,
    $jobTitleFa: String, $jobTitleEn: String,
    $nationalCode: String, $profile: Upload
  ) {
    attendeeUpdateProfileInfo(
      firstnameFa: $firstnameFa
      lastnameFa: $lastnameFa
      firstnameEn: $firstnameEn
      lastnameEn: $lastnameEn
      jobTitleFa: $jobTitleFa
      jobTitleEn: $jobTitleEn
      nationalCode: $nationalCode
      profile: $profile
    )
  }`;
  const fd = new FormData();
  fd.append("operations", JSON.stringify({
    query,
    variables: {
      firstnameFa: fields.firstnameFa || "",
      lastnameFa:  fields.lastnameFa  || "",
      firstnameEn: fields.firstnameEn || "",
      lastnameEn:  fields.lastnameEn  || "",
      jobTitleFa:  fields.jobTitleFa  || null,
      jobTitleEn:  fields.jobTitleEn  || null,
      nationalCode: fields.nationalCode || null,
      profile: null,
    },
  }));
  fd.append("map", JSON.stringify({ "1": ["variables.profile"] }));
  fd.append("1", new File([blob], "profile.jpg", { type: "image/jpeg" }));
  const res = await fetch(RASAYESH_GQL, {
    method: "POST",
    headers: {
      "x-rasayesh-site": "attendee",
      origin: RASAYESH_ORIGIN,
      referer: `${RASAYESH_ORIGIN}/`,
      lang: "fa",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: fd,
  });
  return res.json();
}

const ATTENDEE_QUERY = gql`
  query GetAttendee {
    getAttendee {
      firstname_en lastname_en national_code email profile phone
      occupation_id education_level_id field_of_activities { id } job_title_en
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
    ) { status errors }
  }
`;

const UPDATE_CONTACT = gql`
  mutation UpdateContact($email: String $phone: String) {
    attendeeUpdateProfileContact(email: $email phone: $phone) { status errors }
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
    ) { status errors }
  }
`;

const SEND_MOBILE_OTP = gql`
  mutation SendMobileOTP($mobile: String) {
    attendeeUpdateProfileSendMobileOTP(mobile: $mobile)
  }
`;

const VALIDATE_MOBILE_OTP = gql`
  mutation ValidateMobileOTP($mobile: String, $code: String) {
    attendeeUpdateProfileValidateMobileOTP(mobile: $mobile, code: $code)
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

  // Phone change OTP flow
  const [phoneStep,          setPhoneStep]          = useState("idle"); // "idle" | "input" | "otp"
  const [newPhone,           setNewPhone]           = useState("");
  const [phoneOtp,           setPhoneOtp]           = useState("");
  const [phoneCountdown,     setPhoneCountdown]     = useState(0);
  const [phoneSendLoading,   setPhoneSendLoading]   = useState(false);
  const [phoneSendError,     setPhoneSendError]     = useState("");
  const [phoneVerifyLoading, setPhoneVerifyLoading] = useState(false);
  const [phoneVerifyError,   setPhoneVerifyError]   = useState("");
  const [phoneSuccess,       setPhoneSuccess]       = useState("");

  // Profile photo state
  const [profileUrl,       setProfileUrl]       = useState(null);
  const [cropSrc,          setCropSrc]          = useState(null);
  const [crop,             setCrop]             = useState({ x: 0, y: 0 });
  const [zoom,             setZoom]             = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [uploadingPhoto,   setUploadingPhoto]   = useState(false);
  const [photoError,       setPhotoError]       = useState("");

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

  // Load profile and form options via Apollo
  useEffect(() => {
    const client = getApolloClient();

    client.query({ query: ATTENDEE_QUERY })
      .then(({ data }) => {
        const a = data?.getAttendee;
        if (!a) return;
        // Set profile image URL from the jpg object returned by the API
        const pSrc = a.profile?.jpg?.["128"]
          ? `${RASAYESH_BASE}${a.profile.jpg["128"]}`
          : null;
        setProfileUrl(pSrc);
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
            : (a.field_of_activities ?? []).map(f => f?.id ?? f),
        }));
      })
      .catch(() => {});

    client.query({ query: FORM_OPTIONS_QUERY })
      .then(({ data }) => setFormOptions({
        occupations: data?.occupations ?? [],
        fieldOfActivities: data?.fieldOfActivities ?? [],
        educationLevels: data?.educationLevels ?? [],
      }))
      .catch(() => {})
      .finally(() => setOptionsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phoneCountdown <= 0) return;
    const id = setTimeout(() => setPhoneCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [phoneCountdown]);

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

  // ── Photo upload handlers ─────────────────────────────────────────────────

  function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCropSrc(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // allow re-selecting the same file
  }

  const onCropComplete = useCallback((_, pixels) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function confirmCrop() {
    if (!cropSrc || !croppedAreaPixels) return;
    setUploadingPhoto(true);
    setPhotoError("");
    try {
      const blob = await getCroppedImg(cropSrc, croppedAreaPixels);
      const json = await uploadProfileImage(blob, {
        firstnameFa:  form.firstnameFa  || "",
        lastnameFa:   form.lastnameFa   || "",
        firstnameEn:  form.firstnameEn  || "",
        lastnameEn:   form.lastnameEn   || "",
        jobTitleFa:   form.jobTitleFa   || null,
        jobTitleEn:   form.jobTitleEn   || null,
        nationalCode: form.nationalCode || null,
      });
      const payload = json?.data?.attendeeUpdateProfileInfo;
      if (payload?.status === "invalid") {
        const msg = payload.errors
          ? Object.values(payload.errors).flat().join(", ")
          : "خطا در آپلود تصویر";
        setPhotoError(msg);
        return;
      }
      const profileObj = payload?.data?.profile ?? payload?.profile;
      const newSrc = profileObj?.jpg?.["128"]
        ? `${RASAYESH_BASE}${profileObj.jpg["128"]}`
        : null;
      if (newSrc) setProfileUrl(newSrc);
      // Evict so ProfileClient re-fetches fresh data
      const client = getApolloClient();
      client.cache.evict({ fieldName: "getAttendee" });
      client.cache.evict({ fieldName: "attendee" });
      client.cache.gc();
      setCropSrc(null);
    } catch (err) {
      setPhotoError(err.message || "خطا در آپلود تصویر");
    } finally {
      setUploadingPhoto(false);
    }
  }

  // ── Text-field save handlers ──────────────────────────────────────────────

  async function saveInfo() {
    setInfoState({ saving: true, saved: false, error: "" });
    try {
      const client = getApolloClient();
      const result = await client.mutate({
        mutation: UPDATE_INFO,
        variables: {
          firstnameFa: form.firstnameFa,
          lastnameFa: form.lastnameFa,
          firstnameEn: form.firstnameEn || user?.firstname_en || "",
          lastnameEn: form.lastnameEn || user?.lastname_en || "",
          jobTitleFa: form.jobTitleFa,
          jobTitleEn: form.jobTitleEn,
          nationalCode: form.nationalCode,
        },
      });
      if (result.errors?.length) throw new Error(result.errors[0].message || "خطا در ذخیره‌سازی");
      const payload = result.data?.attendeeUpdateProfileInfo;
      if (payload?.status === 'invalid') {
        const msg = payload.errors ? Object.values(payload.errors).flat().join(', ') : "خطا در ذخیره‌سازی";
        setInfoState({ saving: false, saved: false, error: msg });
        return;
      }
      client.cache.evict({ fieldName: 'getAttendee' });
      client.cache.evict({ fieldName: 'attendee' });
      client.cache.gc();
      await client.query({ query: ATTENDEE_QUERY, fetchPolicy: 'network-only' });
      setInfoState({ saving: false, saved: true, error: "" });
      setTimeout(() => router.push("/profile"), 1500);
    } catch (err) {
      setInfoState({ saving: false, saved: false, error: err.message });
    }
  }

  async function saveContact() {
    setContactState({ saving: true, saved: false, error: "" });
    try {
      const client = getApolloClient();
      const result = await client.mutate({
        mutation: UPDATE_CONTACT,
        variables: { email: form.email },
      });
      if (result.errors?.length) throw new Error(result.errors[0].message || "خطا در ذخیره‌سازی");
      const payload = result.data?.attendeeUpdateProfileContact;
      if (payload?.status === 'invalid') {
        const msg = payload.errors ? Object.values(payload.errors).flat().join(', ') : "خطا در ذخیره‌سازی";
        setContactState({ saving: false, saved: false, error: msg });
        return;
      }
      client.cache.evict({ fieldName: 'getAttendee' });
      client.cache.evict({ fieldName: 'attendee' });
      client.cache.gc();
      await client.query({ query: ATTENDEE_QUERY, fetchPolicy: 'network-only' });
      setContactState({ saving: false, saved: true, error: "" });
      setTimeout(() => router.push("/profile"), 1500);
    } catch (err) {
      setContactState({ saving: false, saved: false, error: err.message });
    }
  }

  async function sendPhoneOtp() {
    setPhoneSendLoading(true);
    setPhoneSendError("");
    try {
      const client = getApolloClient();
      const result = await client.mutate({
        mutation: SEND_MOBILE_OTP,
        variables: { mobile: newPhone },
      });
      const payload = result.data?.attendeeUpdateProfileSendMobileOTP;
      if (payload?.status === "invalid") {
        setPhoneSendError(payload.errors?.mobile?.[0] || "خطا در ارسال کد");
        return;
      }
      setPhoneStep("otp");
      setPhoneCountdown(120);
      setPhoneOtp("");
    } catch (err) {
      setPhoneSendError(err.message || "خطا در ارسال کد");
    } finally {
      setPhoneSendLoading(false);
    }
  }

  async function verifyPhoneOtp() {
    setPhoneVerifyLoading(true);
    setPhoneVerifyError("");
    try {
      const client = getApolloClient();
      const result = await client.mutate({
        mutation: VALIDATE_MOBILE_OTP,
        variables: { mobile: newPhone, code: phoneOtp },
      });
      const payload = result.data?.attendeeUpdateProfileValidateMobileOTP;
      if (payload?.status === "invalid") {
        setPhoneVerifyError(payload.errors?.code?.[0] || "کد نادرست است");
        return;
      }
      set("phone", newPhone);
      const client2 = getApolloClient();
      client2.cache.evict({ fieldName: "getAttendee" });
      client2.cache.evict({ fieldName: "attendee" });
      client2.cache.gc();
      setPhoneStep("idle");
      setNewPhone("");
      setPhoneOtp("");
      setPhoneSuccess("شماره با موفقیت تغییر کرد");
      setTimeout(() => setPhoneSuccess(""), 3000);
    } catch (err) {
      setPhoneVerifyError(err.message || "خطا در تأیید کد");
    } finally {
      setPhoneVerifyLoading(false);
    }
  }

  async function saveActivity() {
    setActivityState({ saving: true, saved: false, error: "" });
    try {
      const client = getApolloClient();
      const result = await client.mutate({
        mutation: UPDATE_ACTIVITY,
        variables: {
          occupationId: form.occupationId ? parseInt(form.occupationId) : null,
          fieldOfActivities: form.fieldOfActivities.map(f => Number(f?.id ?? f)).filter(Boolean),
          educationLevelId: form.educationLevelId ? parseInt(form.educationLevelId) : null,
        },
      });
      if (result.errors?.length) throw new Error(result.errors[0].message || "خطا در ذخیره‌سازی");
      const payload = result.data?.attendeeUpdateProfileActivity;
      if (payload?.status === 'invalid') {
        const msg = payload.errors ? Object.values(payload.errors).flat().join(', ') : "خطا در ذخیره‌سازی";
        setActivityState({ saving: false, saved: false, error: msg });
        return;
      }
      client.cache.evict({ fieldName: 'getAttendee' });
      client.cache.evict({ fieldName: 'attendee' });
      client.cache.gc();
      await client.query({ query: ATTENDEE_QUERY, fetchPolicy: 'network-only' });
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
      {/* ── Crop modal (full-screen overlay) ───────────────────────────── */}
      {cropSrc && (
        <div
          className="fixed inset-0 z-[60] flex flex-col"
          style={{ background: "rgba(2,31,32,0.97)" }}
        >
          <div className="relative flex-1" style={{ minHeight: 0 }}>
            <Cropper
              image={cropSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <div className="px-6 py-2">
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: "var(--accent)" }}
            />
          </div>
          {photoError && (
            <p className="text-xs text-center px-4" style={{ color: "#ef4444" }}>{photoError}</p>
          )}
          <div className="flex gap-3 px-4 pb-24 pt-2">
            <button
              onClick={() => { setCropSrc(null); setPhotoError(""); }}
              className="flex-1 py-3 rounded-xl text-sm font-bold"
              style={{ background: "rgba(255,255,255,0.08)", color: "var(--text)" }}
            >
              {isEN ? "Cancel" : "انصراف"}
            </button>
            <button
              onClick={confirmCrop}
              disabled={uploadingPhoto}
              className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#021f20" }}
            >
              {uploadingPhoto ? "..." : isEN ? "Upload" : "آپلود"}
            </button>
          </div>
        </div>
      )}

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
          {/* ── Profile photo ── */}
          <div className="flex flex-col items-center gap-2 py-2">
            <label
              className="relative cursor-pointer group"
              title={isEN ? "Change photo" : "تغییر تصویر"}
            >
              <div
                className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center border-2"
                style={{ background: "rgba(5,64,65,0.5)", borderColor: "rgba(0,255,179,0.3)" }}
              >
                {profileUrl ? (
                  <img src={profileUrl} alt="profile" className="w-full h-full object-cover" />
                ) : (
                  <span
                    style={{
                      display: "block",
                      width: 40,
                      height: 40,
                      backgroundColor: "var(--text-muted)",
                      maskImage: "url('/logo/user.svg')",
                      maskSize: "contain",
                      maskRepeat: "no-repeat",
                      maskPosition: "center",
                      WebkitMaskImage: "url('/logo/user.svg')",
                      WebkitMaskSize: "contain",
                      WebkitMaskRepeat: "no-repeat",
                      WebkitMaskPosition: "center",
                    }}
                  />
                )}
                <div
                  className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: "rgba(0,0,0,0.45)" }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                    <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
                  </svg>
                </div>
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFileChange}
              />
            </label>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {isEN ? "Tap to change photo" : "برای تغییر تصویر ضربه بزنید"}
            </p>
            {uploadingPhoto && (
              <p className="text-xs" style={{ color: "var(--accent)" }}>
                {isEN ? "Uploading..." : "در حال آپلود..."}
              </p>
            )}
            {photoError && !cropSrc && (
              <p className="text-xs" style={{ color: "#ef4444" }}>{photoError}</p>
            )}
          </div>

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
              {phoneStep === "idle" && (
                <div className="flex items-center gap-2">
                  <div
                    className="flex-1 text-sm"
                    style={{ ...INPUT_STYLE, opacity: 0.7, display: "flex", alignItems: "center" }}
                  >
                    {form.phone ? (isRTL ? toPersianDigits(form.phone) : form.phone) : "—"}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setPhoneStep("input"); setPhoneSendError(""); setPhoneSuccess(""); }}
                    className="text-xs px-3 py-2 rounded-xl font-bold whitespace-nowrap"
                    style={{ background: "rgba(0,255,179,0.1)", color: "var(--accent)", border: "1px solid rgba(0,255,179,0.2)" }}
                  >
                    تغییر شماره
                  </button>
                </div>
              )}
              {phoneStep === "input" && (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input
                      dir="ltr"
                      type="text"
                      inputMode="tel"
                      placeholder="09..."
                      value={isRTL ? toPersianDigits(newPhone) : newPhone}
                      onChange={(e) => setNewPhone(toEnglishDigits(e.target.value).replace(/\D/g, ""))}
                      style={{ ...INPUT_STYLE, flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={sendPhoneOtp}
                      disabled={phoneSendLoading || !newPhone}
                      className="text-xs px-3 py-2 rounded-xl font-bold whitespace-nowrap disabled:opacity-50"
                      style={{ background: "var(--accent)", color: "#021f20" }}
                    >
                      {phoneSendLoading ? "..." : "ارسال کد"}
                    </button>
                  </div>
                  {phoneSendError && (
                    <p className="text-xs" style={{ color: "#ef4444" }}>{phoneSendError}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => { setPhoneStep("idle"); setPhoneSendError(""); setNewPhone(""); }}
                    className="text-xs text-right"
                    style={{ color: "var(--text-dim)" }}
                  >
                    انصراف
                  </button>
                </div>
              )}
              {phoneStep === "otp" && (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input
                      dir="ltr"
                      type="text"
                      inputMode="numeric"
                      placeholder="کد تأیید"
                      value={isRTL ? toPersianDigits(phoneOtp) : phoneOtp}
                      onChange={(e) => setPhoneOtp(toEnglishDigits(e.target.value).replace(/\D/g, "").slice(0, 6))}
                      style={{ ...INPUT_STYLE, flex: 1, textAlign: "center", letterSpacing: 4 }}
                    />
                    <button
                      type="button"
                      onClick={verifyPhoneOtp}
                      disabled={phoneVerifyLoading || phoneOtp.length < 4}
                      className="text-xs px-3 py-2 rounded-xl font-bold whitespace-nowrap disabled:opacity-50"
                      style={{ background: "var(--accent)", color: "#021f20" }}
                    >
                      {phoneVerifyLoading ? "..." : "تأیید"}
                    </button>
                  </div>
                  {phoneVerifyError && (
                    <p className="text-xs" style={{ color: "#ef4444" }}>{phoneVerifyError}</p>
                  )}
                  <div className="flex items-center justify-between">
                    {phoneCountdown > 0 ? (
                      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                        {isRTL ? toPersianDigits(String(phoneCountdown)) : phoneCountdown} ثانیه تا ارسال مجدد
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={sendPhoneOtp}
                        disabled={phoneSendLoading}
                        className="text-xs disabled:opacity-50"
                        style={{ color: "var(--accent)" }}
                      >
                        {phoneSendLoading ? "..." : "ارسال مجدد"}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {phoneSuccess && (
                <p className="text-xs mt-1" style={{ color: "#22c55e" }}>{phoneSuccess}</p>
              )}
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
