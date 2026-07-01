"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useLang } from "@/lib/useLang";
import { toPersianDigits } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

function formatPrice(price, lang) {
  if (!price || price === 0) return lang === "fa" ? "رایگان" : "Free";
  const formatted = Number(price).toLocaleString("en-US");
  return lang === "fa"
    ? `${toPersianDigits(formatted)} تومان`
    : `${formatted} Toman`;
}

function getFeatures(plan, lang) {
  const raw = lang === "fa" ? plan.features_fa : plan.features_en;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  return [];
}

function PlanIcon({ icon }) {
  if (!icon) return <span style={{ fontSize: 28 }}>📋</span>;
  if (icon.trim().startsWith("<")) {
    return (
      <div
        style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}
        dangerouslySetInnerHTML={{ __html: icon }}
      />
    );
  }
  return <span style={{ fontSize: 28 }}>{icon}</span>;
}

function PlanCard({ plan, selected, onToggle, lang, isAutoIncluded }) {
  const isSelectable = (plan.selective || plan.force_selection) && !plan.disabled;
  const isDisabled = !!plan.disabled;
  const isFree = !plan.price || plan.price === 0;
  const title = lang === "en"
    ? (plan.title_en || plan.title_fa || "")
    : (plan.title_fa || plan.title_en || "");
  const description = lang === "en"
    ? (plan.description_en || plan.description_fa || "")
    : (plan.description_fa || plan.description_en || "");
  const features = getFeatures(plan, lang);

  return (
    <div
      onClick={isSelectable ? () => onToggle(plan.id) : undefined}
      className="rounded-3xl p-5 backdrop-blur-xl transition-all"
      style={{
        background: selected
          ? "rgba(0,255,179,0.08)"
          : "rgba(5,64,65,0.4)",
        border: selected
          ? "1px solid rgba(0,255,179,0.4)"
          : "1px solid rgba(0,255,179,0.2)",
        cursor: isSelectable ? "pointer" : "default",
        opacity: isDisabled ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(0,255,179,0.1)", border: "1px solid rgba(0,255,179,0.15)" }}
          >
            <PlanIcon icon={plan.icon} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold leading-snug" style={{ color: "var(--text)" }}>
              {title}
            </h3>
            <p className="text-sm font-black mt-0.5" style={{ color: isFree ? "#22c55e" : "var(--accent)" }}>
              {formatPrice(plan.price, lang)}
            </p>
          </div>
        </div>

        {/* Badge or checkbox */}
        {isAutoIncluded ? (
          <span
            className="flex-shrink-0 text-xs px-2.5 py-1 rounded-full font-bold"
            style={{ background: "rgba(0,255,179,0.12)", color: "var(--accent)", border: "1px solid rgba(0,255,179,0.25)", whiteSpace: "nowrap" }}
          >
            {lang === "fa" ? "✓ شامل این پکیج" : "✓ Included"}
          </span>
        ) : isSelectable ? (
          <div
            className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center transition-all"
            style={{
              border: selected ? "2px solid var(--accent)" : "2px solid rgba(255,255,255,0.3)",
              background: selected ? "var(--accent)" : "transparent",
            }}
          >
            {selected && (
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path d="M1 4L3.5 6.5L9 1" stroke="#021f20" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        ) : null}
      </div>

      {description && (
        <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      )}

      {features.length > 0 && (
        <ul className="flex flex-col gap-1.5 mt-2">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span className="flex-shrink-0 font-bold" style={{ color: "var(--accent)" }}>✓</span>
              <span className="leading-relaxed">{f}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="rounded-3xl h-40"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        />
      ))}
    </div>
  );
}

export default function RegisterClient({ title, subtitle, title_en, subtitle_en }) {
  const { user } = useAuth();
  const { lang, isRTL } = useLang();
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [plans, setPlans] = useState([]);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [selectedPlanIds, setSelectedPlanIds] = useState(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/registration/plans").then((r) => r.json()),
      fetch("/api/badge").then((r) => r.json()).catch(() => null),
    ])
      .then(([plansData, badgeData]) => {
        if (plansData.enabled === false) {
          setEnabled(false);
        } else {
          const fetchedPlans = plansData.plans || [];
          setPlans(fetchedPlans);
          // Pre-select force_selection plans
          const preSelected = new Set(
            fetchedPlans
              .filter((p) => p.force_selection && !p.disabled)
              .map((p) => p.id)
          );
          setSelectedPlanIds(preSelected);
        }
        // Check already registered
        if (badgeData?.data?.attendee) {
          setAlreadyRegistered(true);
        }
      })
      .catch(() => setEnabled(false))
      .finally(() => setLoading(false));
  }, []);

  function togglePlan(id) {
    setSelectedPlanIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function getSubmitPlanIds() {
    const autoIds = plans
      .filter((p) => !p.selective && !p.force_selection && !p.disabled)
      .map((p) => p.id);
    return [...new Set([...autoIds, ...selectedPlanIds])];
  }

  function handleContinue() {
    const planIds = getSubmitPlanIds();
    if (planIds.length === 0) {
      setError(lang === "fa" ? "حداقل یک پلن انتخاب کنید" : "Please select at least one plan");
      return;
    }
    setError("");
    localStorage.setItem("iph-selected-plans", JSON.stringify(planIds));
    // Check profile completeness (has any name in cookie)
    const hasName = user?.firstname_fa || user?.firstname_en;
    if (!hasName) {
      router.push("/register/profile");
    } else {
      router.push("/register/confirm");
    }
  }

  const displayTitle = lang === "en" ? title_en : title;
  const displaySubtitle = lang === "en" ? subtitle_en : subtitle;

  const autoIncludedIds = new Set(
    plans.filter((p) => !p.selective && !p.force_selection).map((p) => p.id)
  );

  return (
    <div
      className="min-h-screen pb-28"
      style={{ background: "var(--bg)" }}
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
    >
      <div className="fixed top-0 right-0 w-72 h-72 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(0,255,179,0.04)", zIndex: 0 }} />
      <div className="fixed bottom-0 left-0 w-80 h-80 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(5,64,65,0.5)", zIndex: 0 }} />

      <div className="relative z-10 max-w-lg mx-auto px-4 pt-4">
        <PageHeader
          title={displayTitle}
          subtitle={displaySubtitle}
          title_en={title_en}
          subtitle_en={subtitle_en}
          showBack
        />

        {loading && <Skeleton />}

        {/* Already registered */}
        {!loading && alreadyRegistered && (
          <div
            className="rounded-3xl p-8 flex flex-col items-center gap-4 text-center mb-4"
            style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)" }}
          >
            <div style={{ fontSize: 48 }}>🪪</div>
            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>
              {lang === "fa" ? "شما قبلاً ثبت‌نام کرده‌اید" : "You are already registered"}
            </p>
            <button
              onClick={() => router.push("/badge")}
              className="px-5 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
              style={{ background: "var(--accent)", color: "#021f20" }}
            >
              {lang === "fa" ? "مشاهده کارت بازدیدکننده" : "View Visitor Card"}
            </button>
          </div>
        )}

        {/* Disabled */}
        {!loading && !enabled && (
          <div
            className="rounded-3xl p-10 flex flex-col items-center gap-4 text-center"
            style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)" }}
          >
            <div style={{ fontSize: 56 }}>🗓️</div>
            <p className="text-sm font-bold leading-7" style={{ color: "var(--text)" }}>
              {lang === "fa"
                ? "ثبت‌نام رویداد در حال حاضر در دسترس نیست"
                : "Registration is not currently available"}
            </p>
            <p className="text-xs leading-7" style={{ color: "var(--text-muted)" }}>
              {lang === "fa"
                ? "ثبت‌نام برای یازدهمین نمایشگاه ایران‌فارما به‌زودی آغاز می‌شود"
                : "Registration for IranPharma Exhibition will open soon"}
            </p>
          </div>
        )}

        {/* Plans */}
        {!loading && enabled && !alreadyRegistered && plans.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  lang={lang}
                  selected={selectedPlanIds.has(plan.id) || autoIncludedIds.has(plan.id)}
                  onToggle={togglePlan}
                  isAutoIncluded={autoIncludedIds.has(plan.id)}
                />
              ))}
            </div>

            {error && (
              <p className="text-xs px-1" style={{ color: "#ef4444" }}>{error}</p>
            )}

            <button
              onClick={handleContinue}
              className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-95"
              style={{ background: "var(--accent)", color: "#021f20" }}
            >
              {lang === "fa" ? "ادامه" : "Continue"}
            </button>
          </div>
        )}

        {!loading && enabled && !alreadyRegistered && plans.length === 0 && (
          <div
            className="rounded-3xl p-10 text-center"
            style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)" }}
          >
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {lang === "fa" ? "پلنی برای نمایش وجود ندارد" : "No plans available"}
            </p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
