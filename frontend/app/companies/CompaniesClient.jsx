"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { toPersianDigits } from "@/lib/utils";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

const LIMIT = 10;

function getLogoUrl(logo, logoBaseUrl) {
  if (!logo) return null;
  const src = logo?.jpg?.["128"] || logo?.jpg?.["64"] || logo?.jpg?.["32"]
    || logo?.png?.["128"] || logo?.png?.["64"] || logo?.png?.["32"]
    || logo?.webp?.["128"] || logo?.webp?.["64"] || logo?.webp?.["32"]
    || logo?.["128"] || logo?.["64"] || logo?.["32"];
  if (!src) return null;
  const base = logoBaseUrl || "https://api.rasayesh.com/";
  return base + src;
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

function CompanyCard({ company, visibleFields, visibleFieldsEn, logoBaseUrl, lang, onNavigate }) {
  const isEN = lang === "en";
  const vf = isEN ? visibleFieldsEn : visibleFields;
  const logoUrl = vf.logo ? getLogoUrl(company.logo, logoBaseUrl) : null;
  const tappable = Boolean(company.slug);
  const letter = company.brand_name_fa?.charAt(0) || company.brand_name_en?.charAt(0) || "؟";

  // Single primary name with language-priority fallback
  const displayName = isEN
    ? (company.brand_name_en || company.brand_name_fa)
    : (company.brand_name_fa || company.brand_name_en);
  const showName = isEN ? (vf.brand_name_en || vf.brand_name_fa) : (vf.brand_name_fa || vf.brand_name_en);

  // Description with language-priority fallback
  const displayDesc = isEN
    ? (company.description_en || company.description_fa)
    : company.description_fa;
  const showDesc = isEN ? vf.description_en : vf.description_fa;

  return (
    <div
      onClick={tappable ? onNavigate : undefined}
      className={`rounded-2xl overflow-hidden flex flex-col transition-all duration-150 active:scale-[0.97]${tappable ? " cursor-pointer hover:scale-[1.02]" : ""}`}
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
            alt={displayName || ""}
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
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            {showName && displayName && (
              <p
                className="text-sm font-semibold leading-snug"
                style={{ color: "var(--text)", direction: isEN ? "ltr" : "rtl" }}
              >
                {displayName}
              </p>
            )}
          </div>
          {tappable && (
            <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--accent)", fontSize: 14, opacity: 0.7 }}>›</span>
          )}
        </div>
        {vf.website && company.website && (
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
              textAlign: isEN ? "left" : "right",
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {company.website.replace(/^https?:\/\//, "")}
          </a>
        )}
        {showDesc && displayDesc && (
          <p
            className="text-xs mt-1 leading-relaxed"
            style={{
              color: "var(--text-muted)",
              display: "-webkit-box",
              WebkitLineClamp: 1,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {displayDesc}
          </p>
        )}
        {company.is_sponsor && (
          <div className="mt-1.5">
            <span
              className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold"
              style={{ background: "#f59e0b", color: "#1c1007" }}
            >
              🌟 {company.sponsor_level || (isEN ? "Sponsor" : "حامی")}
            </span>
          </div>
        )}
        {company.hall_name && company.booth_no && (
          <div
            className="mt-1.5 flex items-center gap-1 text-xs font-medium"
            style={{
              color: "var(--accent)",
              direction: "ltr",
              textAlign: "left",
            }}
          >
            <span>📍</span>
            <span>
              {isEN
                ? `Hall ${company.hall_name} • Booth ${company.booth_no}`
                : `سالن ${company.hall_name} • غرفه ${toPersianDigits(company.booth_no)}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterPill({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 px-4 py-2 rounded-full text-xs font-medium transition-all"
      style={{
        background: active ? "var(--accent)" : "var(--surface)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        color: active ? "#021f20" : "var(--text-muted)",
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
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
  const [halls, setHalls] = useState([]);
  const [selectedHall, setSelectedHall] = useState("");
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [visibleFields, setVisibleFields] = useState({});
  const [visibleFieldsEn, setVisibleFieldsEn] = useState({});
  const [logoBaseUrl, setLogoBaseUrl] = useState("");
  const [eventNameEn, setEventNameEn] = useState("");
  const { lang, isRTL } = useLang();
  const router = useRouter();

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setSort(""); }, [lang]);
  useEffect(() => { setPage(1); }, [debouncedSearch, lang, selectedHall, sort]);

  useEffect(() => {
    setLoading(true);
    const effectiveSort = sort || (lang === "en" ? "name_en" : "name_fa");
    const params = new URLSearchParams({ page, limit: LIMIT, search: debouncedSearch, lang, hall: selectedHall, sort: effectiveSort });
    fetch(`/api/companies?${params}`)
      .then(r => r.json())
      .then(data => {
        setCompanies(data.companies ?? []);
        setTotal(data.total ?? 0);
        setHalls(data.halls ?? []);
        setVisibleFields(data.visibleFields ?? {});
        setVisibleFieldsEn(data.visibleFieldsEn ?? {});
        setLogoBaseUrl(data.logoBaseUrl ?? "");
        setEventNameEn(data.eventNameEn ?? "");
      })
      .catch(() => setCompanies([]))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, lang, selectedHall, sort]);

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
          className="w-full rounded-2xl px-4 py-3 text-sm outline-none mb-3"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            fontFamily: "inherit",
          }}
        />

        <div
          className="flex gap-2 pb-1 mb-3 overflow-x-auto"
          style={{ scrollbarWidth: "none", direction: isRTL ? "rtl" : "ltr" }}
        >
          {lang === "fa" ? (
            <>
              <FilterPill label={t(lang, "companies_sort_name")}  active={!sort || sort === "name_fa"} onClick={() => setSort("name_fa")} />
              <FilterPill label={t(lang, "companies_sort_booth")} active={sort === "booth"}            onClick={() => setSort("booth")} />
              <FilterPill label={t(lang, "companies_sort_hall")}  active={sort === "hall"}             onClick={() => setSort("hall")} />
            </>
          ) : (
            <>
              <FilterPill label={t(lang, "companies_sort_name")}  active={!sort || sort === "name_en"} onClick={() => setSort("name_en")} />
              <FilterPill label={t(lang, "companies_sort_booth")} active={sort === "booth"}            onClick={() => setSort("booth")} />
              <FilterPill label={t(lang, "companies_sort_hall")}  active={sort === "hall"}             onClick={() => setSort("hall")} />
            </>
          )}
        </div>

        {halls.length > 0 && (
          <div
            className="flex gap-2 pb-1 mb-3 overflow-x-auto"
            style={{ scrollbarWidth: "none", direction: isRTL ? "rtl" : "ltr" }}
          >
            <FilterPill
              label={t(lang, "companies_all_halls")}
              active={selectedHall === ""}
              onClick={() => setSelectedHall("")}
            />
            {halls.map(h => (
              <FilterPill
                key={h}
                label={h}
                active={selectedHall === h}
                onClick={() => setSelectedHall(selectedHall === h ? "" : h)}
              />
            ))}
          </div>
        )}

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
              {(debouncedSearch || selectedHall) ? t(lang, "companies_no_results") : t(lang, "companies_empty")}
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {(debouncedSearch || selectedHall)
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
                visibleFieldsEn={visibleFieldsEn}
                logoBaseUrl={logoBaseUrl}
                lang={lang}
                onNavigate={() => router.push("/companies/" + c.slug)}
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
