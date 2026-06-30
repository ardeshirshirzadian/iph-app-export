"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "../../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import { toPersianDigits } from "@/lib/utils";

function formatPrice(price, lang) {
  if (price === undefined || price === null) return "";
  if (Number(price) === 0) return t(lang, "book_free");
  const formatted = Number(price).toLocaleString("en-US");
  return lang === "fa"
    ? `${toPersianDigits(formatted)} ${t(lang, "book_toman")}`
    : `${formatted} ${t(lang, "book_toman")}`;
}

function itemEmoji(entity_type) {
  if (entity_type?.toUpperCase().includes("PDF")) return "📄";
  if (entity_type?.toUpperCase().includes("CD")) return "💿";
  return "📚";
}

function itemLabel(entity_type, lang) {
  if (entity_type?.toUpperCase().includes("PDF")) return t(lang, "book_pdf");
  if (entity_type?.toUpperCase().includes("CD")) return t(lang, "book_cd");
  return t(lang, "book_physical");
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="rounded-3xl h-28" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
      <div className="rounded-3xl h-40" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
    </div>
  );
}

export default function CartClient() {
  const { lang, isRTL } = useLang();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState(null);
  const [bookCover, setBookCover] = useState(null);

  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState("");

  const [payLoading, setPayLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/book/cart-status").then((r) => r.json()),
      fetch("/api/book").then((r) => r.json()),
    ])
      .then(([cartData, bookData]) => {
        setCart(cartData);
        const cover = bookData.book?.cover || bookData.book?.thumbnail;
        if (cover) setBookCover(cover);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleApplyCoupon() {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError("");
    try {
      const res = await fetch("/api/book/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t(lang, "book_coupon_label"));
      setCouponResult(data);
    } catch (err) {
      setCouponError(err.message);
    } finally {
      setCouponLoading(false);
    }
  }

  async function handlePay() {
    setPayLoading(true);
    setError("");
    try {
      const res = await fetch("/api/book/payment", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطا");
      window.location.href = data.redirect_url;
    } catch (err) {
      setError(err.message);
      setPayLoading(false);
    }
  }

  async function handleCancelOrder() {
    setCancelLoading(true);
    try {
      await fetch("/api/book/cart", { method: "DELETE" });
      router.push("/book?cart=cancelled");
    } catch {
      setCancelLoading(false);
    }
  }

  const totalPrice = couponResult?.total_price ?? cart?.total_price ?? 0;
  const priceToPay = couponResult?.price_to_pay ?? cart?.price_to_pay ?? 0;
  const discountAmount = totalPrice - priceToPay;

  const hasCart = cart?.has_open_cart && (cart?.items?.length ?? 0) > 0;

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
          title={t("fa", "book_cart_icon_aria")}
          title_en={t("en", "book_cart_icon_aria")}
          showBack
        />

        {loading && <Skeleton />}

        {!loading && !hasCart && (
          <div
            className="rounded-3xl p-12 flex flex-col items-center gap-5"
            style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)" }}
          >
            <div style={{ fontSize: 64, lineHeight: 1 }}>🛒</div>
            <p className="text-sm font-medium text-center" style={{ color: "var(--text)" }}>
              {t(lang, "book_cart_empty")}
            </p>
            <button
              onClick={() => router.push("/book")}
              className="px-6 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
              style={{ background: "var(--accent)", color: "#021f20" }}
            >
              {t(lang, "book_cart_empty_cta")}
            </button>
          </div>
        )}

        {!loading && hasCart && (
          <div className="flex flex-col gap-4">
            {/* Cart items */}
            <div className="flex flex-col gap-3">
              {cart.items.map((item) => {
                const emoji = itemEmoji(item.entity_type);
                const label = itemLabel(item.entity_type, lang);
                const isPhysical = !item.entity_type?.toUpperCase().includes("PDF") && !item.entity_type?.toUpperCase().includes("CD");
                const itemPrice = item.price_to_pay ?? item.discounted_price ?? item.price ?? 0;

                return (
                  <div
                    key={item.id}
                    className="rounded-3xl p-4 flex items-center gap-4 backdrop-blur-xl"
                    style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)" }}
                  >
                    {/* Thumbnail */}
                    <div
                      className="flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center"
                      style={{ width: 64, height: 64, background: "var(--surface)", border: "1px solid var(--border)" }}
                    >
                      {isPhysical && bookCover ? (
                        <img
                          src={bookCover}
                          alt={label}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span style={{ fontSize: 32 }}>{emoji}</span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold leading-snug" style={{ color: "var(--text)" }}>
                        {label}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {t(lang, "book_original_price")}: {formatPrice(item.price, lang)}
                      </p>
                    </div>

                    {/* Price */}
                    <div className="flex-shrink-0 text-right">
                      <p className="text-sm font-black" style={{ color: "var(--accent)" }}>
                        {formatPrice(itemPrice, lang)}
                      </p>
                      {item.discount > 0 && (
                        <p className="text-xs mt-0.5 line-through" style={{ color: "var(--text-muted)" }}>
                          {formatPrice(item.price, lang)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Coupon section */}
            <div
              className="rounded-3xl p-5 backdrop-blur-xl"
              style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)" }}
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder={t(lang, "book_coupon_label")}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontFamily: "inherit",
                    direction: "ltr",
                  }}
                />
                <button
                  onClick={handleApplyCoupon}
                  disabled={couponLoading || !couponCode.trim()}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--accent)" }}
                >
                  {couponLoading ? "..." : t(lang, "book_coupon_apply")}
                </button>
              </div>
              {couponError && (
                <p className="text-xs mt-2" style={{ color: "#ef4444" }}>{couponError}</p>
              )}
              {couponResult && !couponError && (
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className="text-xs px-2.5 py-1 rounded-full font-bold"
                    style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}
                  >
                    ✓ {t(lang, "book_discount_amount")}: {formatPrice(couponResult.discount_amount, lang)}
                  </span>
                </div>
              )}
            </div>

            {/* Price summary */}
            <div
              className="rounded-3xl p-5 backdrop-blur-xl"
              style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)" }}
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {t(lang, "book_subtotal")}
                  </span>
                  <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                    {formatPrice(totalPrice, lang)}
                  </span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {t(lang, "book_discount_amount")}
                    </span>
                    <span className="text-sm font-bold" style={{ color: "#22c55e" }}>
                      − {formatPrice(discountAmount, lang)}
                    </span>
                  </div>
                )}
                <div
                  className="flex items-center justify-between pt-3"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                    {t(lang, "book_total")}
                  </span>
                  <span className="text-lg font-black" style={{ color: "var(--accent)" }}>
                    {formatPrice(priceToPay, lang)}
                  </span>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs px-1" style={{ color: "#ef4444" }}>{error}</p>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <button
                onClick={handlePay}
                disabled={payLoading}
                className="w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#021f20" }}
              >
                {payLoading ? "..." : t(lang, "book_pay")}
              </button>
              <button
                onClick={handleCancelOrder}
                disabled={cancelLoading}
                className="w-full py-2.5 rounded-xl text-sm font-medium transition-all active:scale-95"
                style={{ border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}
              >
                {cancelLoading ? "..." : t(lang, "book_cancel_order")}
              </button>
            </div>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
