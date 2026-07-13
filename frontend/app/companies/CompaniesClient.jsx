"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { toPersianDigits } from "@/lib/utils";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import { fetchPublicGraphQL } from "@/lib/publicRasayeshClient";

const LIMIT = 10;

const COMPANIES_QUERY = `
  query EventCompanies($search: String, $orderBy: String, $eventId: Int) {
    eventCompanies(search: $search, orderBy: $orderBy, order: "asc", all: true, eventId: $eventId) {
      id slug legal_name_fa legal_name_en brand_name_fa brand_name_en
      logo description_fa description_en website
      booths(eventId: $eventId) { id no hall { id name } }
      eventOptions { show_profile }
    }
    eventCompaniesCount(search: $search, eventId: $eventId)
  }
`;

const SPONSORSHIP_LEVELS_QUERY = `
  query SponsorshipLevels($eventId: Int) {
    sponsorshipLevels(eventId: $eventId, orderBy: "order", order: "asc", all: true) {
      id
      title_fa
      title_en
      icon
      color
      sponsors { id }
    }
  }
`;

const FEATURE_QUERY = `
  query EventFeatureCompanies {
    eventFeatureCompanies {
      company {
        id slug legal_name_fa legal_name_en brand_name_fa brand_name_en logo
      }
    }
  }
`;

function getOrderBy(sort, lang) {
  if (sort === "name_en" || (lang === "en" && !sort)) return "brand_name_en";
  return "brand_name_fa";
}

function mapCompany(raw, sponsorMap) {
  const firstBooth = raw.booths?.[0];
  const sponsorLevel = sponsorMap[raw.id] ?? null;
  return {
    id: raw.id,
    slug: raw.slug,
    brand_name_fa: raw.brand_name_fa,
    brand_name_en: raw.brand_name_en,
    legal_name_fa: raw.legal_name_fa,
    logo: raw.logo,
    website: raw.website,
    description_fa: raw.description_fa,
    description_en: raw.description_en,
    hall_name: firstBooth?.hall?.name ?? null,
    booth_no: firstBooth?.no ?? null,
    is_sponsor: sponsorLevel !== null,
    sponsor_level_obj: sponsorLevel,
  };
}

function getLogoUrl(logo, logoBaseUrl) {
  if (!logo) return null;
  const src =
    logo?.jpg?.["128"] || logo?.jpg?.["64"] || logo?.jpg?.["32"] ||
    logo?.png?.["128"] || logo?.png?.["64"] || logo?.png?.["32"] ||
    logo?.webp?.["128"] || logo?.webp?.["64"] || logo?.webp?.["32"] ||
    logo?.["128"] || logo?.["64"] || logo?.["32"];
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

  const displayName = isEN
    ? (company.brand_name_en || company.brand_name_fa)
    : (company.brand_name_fa || company.brand_name_en);
  const showName = isEN ? (vf.brand_name_en || vf.brand_name_fa) : (vf.brand_name_fa || vf.brand_name_en);

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
            style={{ fontSize: "clamp(24px, 8vw, 40px)", color: "var(--accent)" }}
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
            href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
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
              style={{
                background: company.sponsor_level_obj?.color || "#f59e0b",
                color: "#1c1007",
              }}
            >
              {company.sponsor_level_obj?.icon?.startsWith("<svg")
                ? <span dangerouslySetInnerHTML={{ __html: company.sponsor_level_obj.icon }} style={{ width: 14, height: 14, display: "inline-flex", alignItems: "center", verticalAlign: "middle", flexShrink: 0, overflow: "hidden" }} />
                : (company.sponsor_level_obj?.icon || "🌟")}{" "}
              {isEN
                ? (company.sponsor_level_obj?.title_en || company.sponsor_level_obj?.title_fa || "Sponsor")
                : (company.sponsor_level_obj?.title_fa || "حامی")}
            </span>
          </div>
        )}
        {company.hall_name && company.booth_no && (
          <div
            className="mt-1.5 flex items-center gap-1 text-xs font-medium"
            style={{ color: "var(--accent)", direction: "ltr", textAlign: "left" }}
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
  const [config, setConfig] = useState(null);
  const [allCompanies, setAllCompanies] = useState([]);
  // eslint-disable-next-line no-unused-vars
  const [featureCompanies, setFeatureCompanies] = useState([]);
  const [selectedHall, setSelectedHall] = useState("");
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);
  const [configLoading, setConfigLoading] = useState(true);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const { lang, isRTL } = useLang();
  const router = useRouter();
  const sponsorMapRef = useRef({});

  const loading = configLoading || companiesLoading;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setSort(""); }, [lang]);
  useEffect(() => { setPage(1); }, [debouncedSearch, lang, selectedHall, sort]);

  // Load config + featured companies once on mount.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      setConfigLoading(true);

      // 1. Config — blocking: companies effect waits for this
      let cfg = {};
      try {
        cfg = await fetch("/api/companies/config").then(r => r.json());
      } catch (err) {
        console.error("Companies config fetch error:", err);
      }
      if (cancelled) return;

      // 2. Featured companies + sponsorship levels in parallel
      try {
        const [featResult, levelsResult] = await Promise.all([
          fetchPublicGraphQL(FEATURE_QUERY, {}, cfg.eventOrigin),
          cfg.eventId != null
            ? fetchPublicGraphQL(SPONSORSHIP_LEVELS_QUERY, { eventId: Number(cfg.eventId) }, cfg.eventOrigin)
            : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setFeatureCompanies(featResult?.data?.eventFeatureCompanies ?? []);
          const levels = levelsResult?.data?.sponsorshipLevels ?? [];
          const map = {};
          for (const level of levels) {
            for (const s of level.sponsors ?? []) {
              map[s.id] = { title_fa: level.title_fa, title_en: level.title_en, icon: level.icon, color: level.color };
            }
          }
          sponsorMapRef.current = map;
        }
      } catch (err) {
        console.error("Init parallel fetch error:", err?.graphQLErrors ?? err);
      }
      if (cancelled) return;

      setConfig(cfg);
      setConfigLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, []);

  // Fetch companies from Rasayesh whenever config/search/sort/lang changes
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    setCompaniesLoading(true);

    const variables = {
      orderBy: getOrderBy(sort, lang),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(config.eventId != null ? { eventId: Number(config.eventId) } : {}),
    };

    fetchPublicGraphQL(COMPANIES_QUERY, variables, config.eventOrigin)
      .then(result => {
        if (cancelled) return;
        const raw = result?.data?.eventCompanies ?? [];
        setAllCompanies(raw.map(c => mapCompany(c, sponsorMapRef.current)));
      })
      .catch(err => {
        if (cancelled) return;
        console.error("Companies fetch error:", err.graphQLErrors ?? err);
        setAllCompanies([]);
      })
      .finally(() => { if (!cancelled) setCompaniesLoading(false); });

    return () => { cancelled = true; };
  }, [config, debouncedSearch, sort, lang]);

  // Distinct hall names derived from the current search results
  const halls = useMemo(
    () => [...new Set(allCompanies.map(c => c.hall_name).filter(Boolean))].sort(),
    [allCompanies]
  );

  // Clear selected hall if it disappears from the current result set
  useEffect(() => {
    if (selectedHall && halls.length > 0 && !halls.includes(selectedHall)) {
      setSelectedHall("");
    }
  }, [halls, selectedHall]);

  // Hall filter + client-side sort for booth/hall modes
  const filteredAndSorted = useMemo(() => {
    let list = selectedHall ? allCompanies.filter(c => c.hall_name === selectedHall) : allCompanies;
    if (sort === "booth") {
      list = [...list].sort((a, b) => (parseInt(a.booth_no) || 0) - (parseInt(b.booth_no) || 0));
    } else if (sort === "hall") {
      list = [...list].sort((a, b) =>
        (a.hall_name || "").localeCompare(b.hall_name || "", "fa") ||
        (a.brand_name_fa || "").localeCompare(b.brand_name_fa || "", "fa")
      );
    }
    return list;
  }, [allCompanies, selectedHall, sort]);

  const total = filteredAndSorted.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const companies = filteredAndSorted.slice((page - 1) * LIMIT, page * LIMIT);

  function goToPage(p) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const isEmpty = !loading && companies.length === 0;
  const eventNameEn = config?.eventNameEn ?? "";
  const visibleFields = config?.visibleFields ?? {};
  const visibleFieldsEn = config?.visibleFieldsEn ?? {};
  const logoBaseUrl = config?.logoBaseUrl ?? "";

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
