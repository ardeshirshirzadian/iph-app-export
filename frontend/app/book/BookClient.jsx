"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import { toPersianDigits } from "@/lib/utils";

const ADD_TO_CART = gql`
  mutation AddToCart($bookId: Int!, $bookCount: Int!, $cdCount: Int!, $pdfCount: Int!) {
    addItemToCart(
      itemType: "EventExhibitionBook"
      itemId: $bookId
      metadata: {book_count: $bookCount, cd_count: $cdCount, pdf_count: $pdfCount}
    )
  }
`;

function formatPrice(price, lang) {
  if (!price || price === 0) return t(lang, "book_free");
  const num = Number(price);
  const formatted = num.toLocaleString("en-US");
  return lang === "fa"
    ? `${toPersianDigits(formatted)} ${t(lang, "book_toman")}`
    : `${formatted} ${t(lang, "book_toman")}`;
}

function QuantityControl({ value, onChange, min = 0, max = 10 }) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold transition-all active:scale-95 disabled:opacity-30"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-bold" style={{ color: "var(--text)" }}>
        {value}
      </span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold transition-all active:scale-95 disabled:opacity-30"
        style={{ background: "var(--accent)", color: "#021f20" }}
      >
        +
      </button>
    </div>
  );
}

function ProductRow({ emoji, label, price, count, onChange, lang }) {
  const priceLabel = formatPrice(price, lang);
  return (
    <div
      className="flex items-center justify-between gap-3 py-3"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-lg flex-shrink-0">{emoji}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug" style={{ color: "var(--text)" }}>{label}</p>
          <p className="text-xs" style={{ color: price === 0 ? "var(--accent)" : "var(--text-muted)" }}>
            {priceLabel}
          </p>
        </div>
      </div>
      <QuantityControl value={count} onChange={onChange} />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse rounded-3xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div style={{ height: 240, background: "rgba(255,255,255,0.04)" }} />
      <div className="p-5 flex flex-col gap-3">
        <div className="h-5 rounded-lg w-3/4" style={{ background: "rgba(255,255,255,0.06)" }} />
        <div className="h-3 rounded w-1/2" style={{ background: "rgba(255,255,255,0.04)" }} />
        <div className="h-3 rounded w-full" style={{ background: "rgba(255,255,255,0.04)" }} />
        <div className="h-3 rounded w-5/6" style={{ background: "rgba(255,255,255,0.04)" }} />
      </div>
    </div>
  );
}

export default function BookClient({ title, subtitle, title_en, subtitle_en }) {
  const { lang, isRTL } = useLang();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [book, setBook] = useState(null);
  const [bookId, setBookId] = useState(6);
  const [enabled, setEnabled] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);

  const [bookCount, setBookCount] = useState(0);
  const [cdCount,   setCdCount]   = useState(0);
  const [pdfCount,  setPdfCount]  = useState(0);

  const [addingToCart, setAddingToCart] = useState(false);
  const [cartError,    setCartError]    = useState("");

  useEffect(() => {
    fetch("/api/book")
      .then((r) => r.json())
      .then((data) => {
        setEnabled(data.enabled !== false);
        if (data.book_id) setBookId(data.book_id);
        if (data.book) {
          setBook(data.book);
          const hasBook = (data.book.book_capacity ?? 0) > 0 || data.book.book_price === 0;
          setBookCount(hasBook ? 1 : 0);
        }
      })
      .catch(() => setEnabled(false))
      .finally(() => setLoading(false));
  }, []);

  async function handleAddToCart() {
    if (bookCount + cdCount + pdfCount === 0) return;
    setAddingToCart(true);
    setCartError("");
    try {
      const client = getApolloClient();
      const { errors } = await client.mutate({
        mutation: ADD_TO_CART,
        variables: { bookId, bookCount, cdCount, pdfCount },
      });
      if (errors?.length) throw new Error(errors[0].message || "خطا");
      router.push("/cart");
    } catch (err) {
      setCartError(err.message);
      setAddingToCart(false);
    }
  }

  const cover = book?.cover || book?.thumbnail;
  const displayTitle = (lang === "en" && book?.title_en) ? book.title_en : (book?.title_fa ?? "");
  const displayDesc  = (lang === "en" && book?.description_en) ? book.description_en : (book?.description_fa ?? "");
  const displayPublisher = (lang === "en" && book?.publisher_en) ? book.publisher_en : (book?.publisher_fa ?? "");
  const MAX_DESC = 200;
  const isLongDesc = displayDesc.length > MAX_DESC;
  const shownDesc = isLongDesc && !descExpanded ? displayDesc.slice(0, MAX_DESC) + "…" : displayDesc;

  const showBookRow = (book?.book_capacity ?? 1) > 0 || (book?.book_price === 0);
  const showCdRow   = (book?.cd_capacity   ?? 0) > 0 || (book?.cd_price   === 0 && (book?.cd_capacity ?? 0) > 0);
  const showPdfRow  = (book?.pdf_capacity  ?? 0) > 0 || (book?.pdf_price  === 0 && (book?.pdf_capacity ?? 0) > 0);

  const anySelected = bookCount + cdCount + pdfCount > 0;

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
        <PageHeader title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />

        {loading && <Skeleton />}

        {!loading && !enabled && (
          <div
            className="rounded-3xl p-10 text-center"
            style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)" }}
          >
            <div className="text-4xl mb-3">📚</div>
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t(lang, "book_disabled")}
            </p>
          </div>
        )}

        {!loading && enabled && !book && (
          <div
            className="rounded-3xl p-10 text-center"
            style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)" }}
          >
            <div className="text-4xl mb-3">📚</div>
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              {t(lang, "book_loading")}
            </p>
          </div>
        )}

        {!loading && enabled && book && (
          <div className="flex flex-col gap-4">
            {/* Book display card */}
            <div className="rounded-3xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              {cover && (
                <div className="w-full" style={{ background: "#ffffff" }}>
                  <img
                    src={cover}
                    alt={displayTitle}
                    className="w-full object-cover"
                    style={{ maxHeight: 300, objectPosition: "top" }}
                  />
                </div>
              )}
              {!cover && (
                <div className="w-full flex items-center justify-center" style={{ height: 180, background: "rgba(0,255,179,0.06)" }}>
                  <span style={{ fontSize: 72 }}>📚</span>
                </div>
              )}

              <div className="p-5">
                {displayTitle && (
                  <h2 className="text-lg font-black leading-7 mb-2" style={{ color: "var(--text)" }}>
                    {displayTitle}
                  </h2>
                )}

                <div className="flex items-center gap-3 flex-wrap mb-3">
                  {displayPublisher && (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {t(lang, "book_publisher")}: {displayPublisher}
                    </span>
                  )}
                  {book.page_count && (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {lang === "fa" ? toPersianDigits(String(book.page_count)) : book.page_count} {t(lang, "book_pages")}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {showBookRow && (
                    <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(0,255,179,0.1)", color: "var(--accent)", border: "1px solid rgba(0,255,179,0.2)" }}>
                      📚 {formatPrice(book.book_price, lang)}
                    </span>
                  )}
                  {showCdRow && (
                    <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(0,255,179,0.1)", color: "var(--accent)", border: "1px solid rgba(0,255,179,0.2)" }}>
                      💿 {formatPrice(book.cd_price, lang)}
                    </span>
                  )}
                  {showPdfRow && (
                    <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(0,255,179,0.1)", color: "var(--accent)", border: "1px solid rgba(0,255,179,0.2)" }}>
                      📄 {formatPrice(book.pdf_price, lang)}
                    </span>
                  )}
                </div>

                {displayDesc && (
                  <div>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      {shownDesc}
                    </p>
                    {isLongDesc && (
                      <button
                        onClick={() => setDescExpanded((v) => !v)}
                        className="text-xs mt-1 font-medium"
                        style={{ color: "var(--accent)" }}
                      >
                        {descExpanded ? t(lang, "book_show_less") : t(lang, "book_show_more")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Order selection card */}
            <div
              className="rounded-3xl p-5 backdrop-blur-xl"
              style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)" }}
            >
              <h3 className="text-sm font-bold mb-4" style={{ color: "var(--accent)" }}>
                {t(lang, "book_select_product")}
              </h3>

              {showBookRow && (
                <ProductRow
                  emoji="📚"
                  label={t(lang, "book_physical")}
                  price={book.book_price}
                  count={bookCount}
                  onChange={setBookCount}
                  lang={lang}
                />
              )}
              {showCdRow && (
                <ProductRow
                  emoji="💿"
                  label={t(lang, "book_cd")}
                  price={book.cd_price}
                  count={cdCount}
                  onChange={setCdCount}
                  lang={lang}
                />
              )}
              {showPdfRow && (
                <ProductRow
                  emoji="📄"
                  label={t(lang, "book_pdf")}
                  price={book.pdf_price}
                  count={pdfCount}
                  onChange={setPdfCount}
                  lang={lang}
                />
              )}

              {cartError && (
                <p className="text-xs mt-3" style={{ color: "#ef4444" }}>{cartError}</p>
              )}

              <div className="mt-4">
                <button
                  onClick={handleAddToCart}
                  disabled={!anySelected || addingToCart}
                  className="w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50"
                  style={{ background: "var(--accent)", color: "#021f20" }}
                >
                  {addingToCart ? "..." : t(lang, "book_add_to_cart")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
