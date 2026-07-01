"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import BottomNav from "@/app/components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/lib/useLang";
import { toPersianDigits } from "@/lib/utils";

const ADD_WIZARD_ITEMS = gql`
  mutation AddWizardItems($planIds: [Int!]!, $redirectUrl: String!) {
    addWizardItemsToCart(items: { plan_ids: $planIds }, redirectUrl: $redirectUrl)
  }
`;

function formatPrice(price, lang) {
  if (!price || price === 0) return lang === "fa" ? "رایگان" : "Free";
  return lang === "fa"
    ? `${toPersianDigits(Number(price).toLocaleString("en-US"))} تومان`
    : `${Number(price).toLocaleString("en-US")} Toman`;
}

export default function ConfirmClient() {
  const { user } = useAuth();
  const router = useRouter();
  const { lang, isRTL } = useLang();

  const [planIds, setPlanIds] = useState([]);
  const [plans, setPlans] = useState([]);
  const [selectedPlans, setSelectedPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("iph-selected-plans");
    const ids = saved ? JSON.parse(saved) : [];
    setPlanIds(ids);

    fetch("/api/registration/plans")
      .then((r) => r.json())
      .then((data) => {
        const allPlans = data.plans ?? [];
        setPlans(allPlans);
        setSelectedPlans(allPlans.filter((p) => ids.includes(p.id)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalPrice = selectedPlans.reduce((sum, p) => sum + (p.price || 0), 0);
  const isFree = totalPrice === 0;

  async function handleConfirm() {
    if (planIds.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const client = getApolloClient();
      const { data, errors } = await client.mutate({
        mutation: ADD_WIZARD_ITEMS,
        variables: {
          planIds: planIds.map(Number).filter(Boolean),
          redirectUrl: "https://app.iphexpo.com/cart/callback",
        },
      });

      if (errors?.length) throw new Error(errors[0].message || "خطا در ثبت‌نام");

      const result = data?.addWizardItemsToCart;
      if (result?.redirect_url) {
        localStorage.removeItem("iph-selected-plans");
        window.location.href = result.redirect_url;
        return;
      }
      if (result?.status === 'success' || result?.success === true || result) {
        localStorage.removeItem("iph-selected-plans");
        router.push("/badge");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const displayName = lang === "fa"
    ? `${user?.firstname_fa || ""} ${user?.lastname_fa || ""}`.trim()
    : `${user?.firstname_en || ""} ${user?.lastname_en || ""}`.trim()
      || `${user?.firstname_fa || ""} ${user?.lastname_fa || ""}`.trim();

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
          title={lang === "fa" ? "تأیید ثبت‌نام" : "Confirm Registration"}
          title_en="Confirm Registration"
          subtitle={lang === "fa" ? "اطلاعات و پلن‌های انتخابی را بررسی کنید" : "Review your info and selected plans"}
          subtitle_en="Review your info and selected plans"
          showBack
        />

        {loading ? (
          <div className="flex flex-col gap-4 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-3xl h-28" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* User info card */}
            <div
              className="rounded-3xl p-5 backdrop-blur-xl border"
              style={{ background: "rgba(5,64,65,0.4)", borderColor: "rgba(0,255,179,0.2)" }}
            >
              <p className="text-xs font-bold mb-3" style={{ color: "var(--text-dim)" }}>
                {lang === "fa" ? "اطلاعات شما" : "Your Information"}
              </p>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base"
                  style={{ background: "var(--accent)", color: "#021f20" }}
                >
                  {(displayName?.[0] || "?").toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm" style={{ color: "var(--text)" }}>
                    {displayName || (lang === "fa" ? "کاربر" : "User")}
                  </p>
                  {user?.mobile && (
                    <p className="text-xs mt-0.5" dir="ltr" style={{ color: "var(--text-dim)" }}>
                      {lang === "fa" ? toPersianDigits(user.mobile) : user.mobile}
                    </p>
                  )}
                  {user?.email && (
                    <p className="text-xs mt-0.5" dir="ltr" style={{ color: "var(--text-dim)" }}>
                      {user.email}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Selected plans */}
            <div
              className="rounded-3xl p-5 backdrop-blur-xl border"
              style={{ background: "rgba(5,64,65,0.4)", borderColor: "rgba(0,255,179,0.2)" }}
            >
              <p className="text-xs font-bold mb-3" style={{ color: "var(--text-dim)" }}>
                {lang === "fa" ? "پلن‌های انتخاب‌شده" : "Selected Plans"}
              </p>
              {selectedPlans.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                  {lang === "fa" ? "پلنی انتخاب نشده" : "No plans selected"}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {selectedPlans.map((plan) => {
                    const title = lang === "fa"
                      ? (plan.title_fa || plan.title_en)
                      : (plan.title_en || plan.title_fa);
                    return (
                      <div
                        key={plan.id}
                        className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
                        style={{ background: "rgba(0,255,179,0.06)", border: "1px solid rgba(0,255,179,0.15)" }}
                      >
                        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                          {title}
                        </p>
                        <p className="text-sm font-bold flex-shrink-0" style={{ color: plan.price ? "var(--accent)" : "#22c55e" }}>
                          {formatPrice(plan.price, lang)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Total */}
            {selectedPlans.length > 0 && (
              <div
                className="rounded-2xl px-5 py-3 flex items-center justify-between"
                style={{ background: isFree ? "rgba(34,197,94,0.08)" : "rgba(0,255,179,0.06)", border: `1px solid ${isFree ? "rgba(34,197,94,0.2)" : "rgba(0,255,179,0.2)"}` }}
              >
                <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                  {lang === "fa" ? "جمع کل" : "Total"}
                </span>
                <span className="text-base font-black" style={{ color: isFree ? "#22c55e" : "var(--accent)" }}>
                  {formatPrice(totalPrice, lang)}
                </span>
              </div>
            )}

            {error && (
              <p className="text-xs px-1" style={{ color: "#ef4444" }}>{error}</p>
            )}

            <button
              onClick={handleConfirm}
              disabled={submitting || selectedPlans.length === 0}
              className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#021f20" }}
            >
              {submitting
                ? (lang === "fa" ? "در حال پردازش..." : "Processing...")
                : isFree
                  ? (lang === "fa" ? "تأیید ثبت‌نام" : "Confirm Registration")
                  : (lang === "fa" ? "پرداخت" : "Proceed to Payment")}
            </button>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
