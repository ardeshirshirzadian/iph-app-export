"use client";

import { useState, useEffect } from "react";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { toPersianDigits } from "@/lib/utils";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

const LIMIT = 10;

function getLogoUrl(logo, logoBaseUrl) {
  const src = logo?.jpg?.["128"] || logo?.jpg?.["64"] || logo?.jpg?.["32"];
  return src ? logoBaseUrl + src : null;
}

function getPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push("…");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}

function CompanyCard({ company, visibleFields, logoBaseUrl }) {
  const logoUrl = visibleFields.logo ? getLogoUrl(company.logo, logoBaseUrl) : null;
  const letter = company.brand_name_fa?.charAt(0) || company.brand_name_en?.charAt(0) || "؟";

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col transition-all duration-150 active:scale-[0.97]"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div
        className="flex items-center justify-center w-full"
        style={{
          aspectRatio: "1 / 1",
          background: logoUrl ? "#ffffff" : "color-mix(in srgb, var(--accent) 10%, transparent)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={company.brand_name_fa || ""}
            style={{ width: "100%", height: "100%", objectFit: "contain", padding: 8 }}
          />
        ) : (
          <span
            className="font-bold"
            style={{
              fontSize: "clamp(24px, 8vw, 40px)",
              color: "var(--accent)",
            }}
          >
            {letter}
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col gap-0.5 flex-1">
        {visibleFields.brand_name_fa && company.brand_name_fa && (
          <p
            className="text-sm font-semibold leading-snug"
            style={{ color: "var(--text)" }}
          >
            {company.brand_name_fa}
          </p>
        )}
        {visibleFields.brand_name_en && company.brand_name_en && (
          <p
            className="text-xs"
            style={{
              color: "var(--text-muted)",
              direction: "ltr",
              textAlign: "right",
            }}
          >
            {company.brand_name_en}
          </p>
        )}
        {visibleFields.website && company.website && (
          <a
            href={
              company.website.startsWith("http")
                ? company.website
                : `https://${company.website}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs mt-0.5"
            onClick={e => e.stopPropagation()}
            style={{
              color: "var(--accent)",
              direction: "ltr",
              textAlign: "right",
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {company.website.replace(/^https?:\/\//, "")}
          </a>
        )}
        {visibleFields.description_fa && company.description_fa && (
          <p
            className="text-xs mt-1 leading-relaxed"
            style={{
              color: "var(--text-muted)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {company.description_fa}
          </p>
        )}
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div
        className="w-full animate-pulse"
        style={{ aspectRatio: "1 / 1", background: "rgba(255,255,255,0.04)" }}
      />
      <div className="p-3 flex flex-col gap-2">
        <div className="rounded animate-pulse" style={{ height: 13, width: "70%", background: "rgba(255,255,255,0.05)" }} />
        <div className="rounded animate-pulse" style={{ height: 11, width: "50%", background: "rgba(255,255,255,0.04)" }} />
      </div>
    </div>
  );
}

export default function CompaniesClient({ title, subtitle, title_en, subtitle_en }) {
  const [companies, setCompanies] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [visibleFields, setVisibleFields] = useState({});
  const [logoBaseUrl, setLogoBaseUrl] = useState("");
  const [eventNameEn, setEventNameEn] = useState("");
  const { lang, isRTL } = useLang();

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPage(1); }, [debouncedSearch]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit: LIMIT, search: debouncedSearch });
    fetch(`/api/companies?${params}`)
      .then(r => r.json())
      .then(data => {
        setCompanies(data.companies ?? []);
        setTotal(data.total ?? 0);
        setVisibleFields(data.visibleFields ?? {});
        setLogoBaseUrl(data.logoBaseUrl ?? "");
        setEventNameEn(data.eventNameEn ?? "");
      })
      .catch(() => setCompanies([]))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch]);

  function goToPage(p) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const isEmpty = !loading && companies.length === 0;

  const totalCountLabel = lang === "fa"
    ? `${toPersianDigits(total)} ${t(lang, "companies_count_suffix")}`
    : `${total} ${t(lang, "companies_count_suffix")}`;

  return (
    <div
      className="min-h-screen pb-28"
      style={{ background: "var(--bg)" }}
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
    >
      <div
        className="fixed top-0 right-0 w-72 h-72 rounded-full blur-3xl pointer-events-none"
        style={{ background: "rgba(0,255,179,0.04)", zIndex: 0 }}
      />
      <div
        className="fixed bottom-0 left-0 w-80 h-80 rounded-full blur-3xl pointer-events-none"
        style={{ background: "rgba(5,64,65,0.5)", zIndex: 0 }}
      />

      <div className="relative z-10 max-w-lg mx-auto px-4 pt-4">
        <PageHeader title={title} subtitle={subtitle} title_en={eventNameEn || title_en} subtitle_en={subtitle_en} />

        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t(lang, "companies_search")}
          className="w-full rounded-2xl px-4 py-3 text-sm outline-none mb-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            fontFamily: "inherit",
          }}
        />

        {!loading && total > 0 && (
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            {totalCountLabel}
          </p>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: LIMIT }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : isEmpty ? (
          <div
            className="rounded-3xl p-10 text-center mt-6"
            style={{
              background: "rgba(5,64,65,0.4)",
              border: "1px solid rgba(0,255,179,0.2)",
              backdropFilter: "blur(12px)",
            }}
          >
            <div className="text-4xl mb-3">🏢</div>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
              {debouncedSearch ? t(lang, "companies_no_results") : t(lang, "companies_empty")}
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {debouncedSearch
                ? t(lang, "companies_try_other")
                : t(lang, "companies_sync_hint")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {companies.map(c => (
              <CompanyCard
                key={c.id}
                company={c}
                visibleFields={visibleFields}
                logoBaseUrl={logoBaseUrl}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-6 flex-wrap">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all disabled:opacity-30"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            >
              {t(lang, "companies_prev")}
            </button>

            {getPageNumbers(page, totalPages).map((p, i) =>
              p === "…" ? (
                <span key={`ellipsis-${i}`} className="px-1 text-xs" style={{ color: "var(--text-muted)" }}>…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  className="w-8 h-8 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: p === page ? "var(--accent)" : "var(--surface)",
                    border: `1px solid ${p === page ? "var(--accent)" : "var(--border)"}`,
                    color: p === page ? "#021f20" : "var(--text)",
                  }}
                >
                  {lang === "fa" ? toPersianDigits(p) : p}
                </button>
              )
            )}

            <button
              onClick={() => goToPage(page + 1)}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all disabled:opacity-30"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            >
              {t(lang, "companies_next")}
            </button>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
