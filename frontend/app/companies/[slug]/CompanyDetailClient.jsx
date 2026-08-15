"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "@/app/components/BottomNav";
import AppHeaderRaw from "@/app/components/AppHeader";
import { useLang } from "@/lib/useLang";
import { toPersianDigits } from "@/lib/utils";

// AppHeader calls useSearchParams() internally (see components/PageHeader.jsx
// for the full rationale) -- needs a Suspense boundary to allow this route to
// be statically/ISR-prerendered. This file imports AppHeader directly
// (bypassing PageHeader), so it needs its own wrapper.
function AppHeader(props) {
  return (
    <Suspense fallback={null}>
      <AppHeaderRaw {...props} />
    </Suspense>
  );
}

// Company detail comes live from Rasayesh (external CRM), previously
// fetched directly from the browser via fetchPublicGraphQL(). Now proxied
// through app/api/companies/data/route.js (type=detail), which wraps the
// same GraphQL query in a server-side 60s unstable_cache.

function getLogoUrl(logo, logoBaseUrl) {
  if (!logo) return null;
  const src =
    logo?.jpg?.["256"] || logo?.jpg?.["128"] || logo?.jpg?.["64"] ||
    logo?.png?.["256"] || logo?.png?.["128"] || logo?.png?.["64"] ||
    logo?.webp?.["256"] || logo?.webp?.["128"] || logo?.webp?.["64"] ||
    logo?.["256"] || logo?.["128"] || logo?.["64"];
  if (!src) return null;
  const base = logoBaseUrl || "https://api.rasayesh.com/";
  return base + src;
}

function normalizePhones(phones) {
  if (!phones) return [];
  if (Array.isArray(phones)) return phones.filter(Boolean);
  if (typeof phones === "string") return phones.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function normalizeEmails(emails) {
  if (!emails) return [];
  if (Array.isArray(emails)) return emails.filter(Boolean);
  if (typeof emails === "string") return emails.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function Section({ title, children }) {
  return (
    <div
      className="rounded-3xl p-5 mb-4"
      style={{
        background: "rgba(5,64,65,0.4)",
        border: "1px solid rgba(0,255,179,0.2)",
        backdropFilter: "blur(12px)",
      }}
    >
      <p className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: "var(--accent)" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="rounded-3xl mx-auto mb-5" style={{ width: 256, height: 256, background: "rgba(255,255,255,0.05)" }} />
      <div className="rounded-3xl p-5 mb-4" style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.1)" }}>
        <div className="rounded mb-3" style={{ height: 12, width: "40%", background: "rgba(255,255,255,0.06)" }} />
        <div className="rounded mb-2" style={{ height: 16, width: "70%", background: "rgba(255,255,255,0.08)" }} />
        <div className="rounded" style={{ height: 14, width: "55%", background: "rgba(255,255,255,0.06)" }} />
      </div>
      <div className="rounded-3xl p-5 mb-4" style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.1)" }}>
        <div className="rounded mb-3" style={{ height: 12, width: "30%", background: "rgba(255,255,255,0.06)" }} />
        <div className="rounded mb-2" style={{ height: 14, background: "rgba(255,255,255,0.05)" }} />
        <div className="rounded mb-2" style={{ height: 14, width: "85%", background: "rgba(255,255,255,0.05)" }} />
        <div className="rounded" style={{ height: 14, width: "60%", background: "rgba(255,255,255,0.05)" }} />
      </div>
      <div className="rounded-3xl p-5 mb-4" style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.1)" }}>
        <div className="rounded mb-3" style={{ height: 12, width: "25%", background: "rgba(255,255,255,0.06)" }} />
        <div className="rounded" style={{ height: 14, width: "50%", background: "rgba(255,255,255,0.05)" }} />
      </div>
    </div>
  );
}

export default function CompanyDetailClient({ slug }) {
  const { lang, isRTL } = useLang();
  const router = useRouter();
  const [imgError, setImgError] = useState(false);
  const [company, setCompany] = useState(null);
  const [logoBaseUrl, setLogoBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFoundState, setNotFoundState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFoundState(false);
    setImgError(false);

    // config (for logoBaseUrl) and detail (event context resolved server-side)
    // are independent now, so fetch in parallel instead of sequentially.
    Promise.all([
      fetch("/api/companies/config").then((r) => r.json()),
      fetch(`/api/companies/data?type=detail&slug=${encodeURIComponent(slug)}`).then((r) => r.json()),
    ])
      .then(([cfg, detailResult]) => {
        if (cancelled) return;

        const base = cfg.logoBaseUrl || "https://api.rasayesh.com/";
        const raw = detailResult?.company;
        if (!raw) {
          setNotFoundState(true);
          return;
        }

        setLogoBaseUrl(base);
        setCompany({
          ...raw,
          hall_name: raw.booths?.[0]?.hall?.name ?? null,
          booth_no: raw.booths?.[0]?.no ?? null,
          is_sponsor: (raw.sponsorshipLevels?.length ?? 0) > 0,
          sponsor_level: raw.sponsorshipLevels?.[0]?.title_fa || null,
        });
      })
      .catch(() => {
        if (!cancelled) setNotFoundState(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [slug]);

  const isEN = lang === "en";

  if (loading) {
    return (
      <div
        className="min-h-screen pb-28"
        style={{ background: "var(--bg)", color: "var(--text)" }}
        dir={isRTL ? "rtl" : "ltr"}
        lang={lang}
      >
        <div className="dark-only fixed top-0 right-0 w-72 h-72 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(0,255,179,0.04)", zIndex: 0 }} />
        <div className="dark-only fixed bottom-0 left-0 w-80 h-80 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(5,64,65,0.5)", zIndex: 0 }} />
        <div className="relative z-10 max-w-lg mx-auto px-4 pt-4">
          <AppHeader />
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-xl" style={{ width: 38, height: 38, background: "var(--surface)", border: "1px solid var(--border)" }} />
            <div className="flex-1">
              <div className="rounded animate-pulse" style={{ height: 18, width: "55%", background: "rgba(255,255,255,0.08)" }} />
            </div>
          </div>
          <LoadingSkeleton />
        </div>
        <BottomNav />
      </div>
    );
  }

  if (notFoundState) {
    return (
      <div
        className="min-h-screen pb-28"
        style={{ background: "var(--bg)", color: "var(--text)" }}
        dir={isRTL ? "rtl" : "ltr"}
        lang={lang}
      >
        <div className="dark-only fixed top-0 right-0 w-72 h-72 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(0,255,179,0.04)", zIndex: 0 }} />
        <div className="dark-only fixed bottom-0 left-0 w-80 h-80 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(5,64,65,0.5)", zIndex: 0 }} />
        <div className="relative z-10 max-w-lg mx-auto px-4 pt-4">
          <AppHeader />
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => router.push("/companies")}
              className="flex-shrink-0 flex items-center justify-center rounded-xl transition-all active:scale-95"
              style={{ width: 38, height: 38, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 20 }}
            >
              ‹
            </button>
          </div>
          <div
            className="rounded-3xl p-10 text-center mt-6"
            style={{ background: "rgba(5,64,65,0.4)", border: "1px solid rgba(0,255,179,0.2)", backdropFilter: "blur(12px)" }}
          >
            <div className="text-4xl mb-3">🏢</div>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
              {isEN ? "Company not found" : "شرکت یافت نشد"}
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {isEN ? "The company page you're looking for doesn't exist." : "صفحه شرکت مورد نظر وجود ندارد."}
            </p>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  const logoUrl = !imgError ? getLogoUrl(company.logo, logoBaseUrl) : null;
  const brandName = (isEN && company.brand_name_en) ? company.brand_name_en : company.brand_name_fa;
  const brandNameAlt = isEN ? company.brand_name_fa : company.brand_name_en;
  const description = isEN ? (company.description_en || company.description_fa) : company.description_fa;
  const address = isEN ? (company.address_en || company.address_fa) : company.address_fa;
  const phones = normalizePhones(company.phones);
  const emails = normalizeEmails(company.emails);

  const letter = company.brand_name_fa?.charAt(0) || company.brand_name_en?.charAt(0) || "؟";

  return (
    <div
      className="min-h-screen pb-28"
      style={{ background: "var(--bg)", color: "var(--text)" }}
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
    >
      {/* Background glows */}
      <div className="dark-only fixed top-0 right-0 w-72 h-72 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(0,255,179,0.04)", zIndex: 0 }} />
      <div className="dark-only fixed bottom-0 left-0 w-80 h-80 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(5,64,65,0.5)", zIndex: 0 }} />

      <div className="relative z-10 max-w-lg mx-auto px-4 pt-4">
        <AppHeader />

        {/* Back button + title */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => router.push("/companies")}
            aria-label={isEN ? "Back to companies" : "بازگشت به شرکت‌ها"}
            className="flex-shrink-0 flex items-center justify-center rounded-xl transition-all active:scale-95"
            style={{
              width: 38,
              height: 38,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontSize: 20,
            }}
          >
            ‹
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold leading-snug truncate" style={{ color: "var(--text)" }}>
              {brandName || "—"}
            </h1>
            {brandNameAlt && (
              <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)", direction: isEN ? "rtl" : "ltr" }}>
                {brandNameAlt}
              </p>
            )}
          </div>
        </div>

        {/* Logo card */}
        <div
          className="rounded-3xl flex items-center justify-center mb-5 mx-auto overflow-hidden"
          style={{
            width: 256,
            height: 256,
            background: logoUrl ? "#ffffff" : "rgba(0,255,179,0.08)",
            border: "1px solid rgba(0,255,179,0.2)",
          }}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={brandName || ""}
              onError={() => setImgError(true)}
              style={{ width: "80%", height: "80%", objectFit: "contain" }}
            />
          ) : (
            <span className="font-bold" style={{ fontSize: 64, color: "var(--accent)" }}>
              {letter}
            </span>
          )}
        </div>

        {/* Sponsor badge */}
        {company.is_sponsor && (
          <div className="flex justify-center mb-4">
            <span
              className="inline-flex items-center gap-1 px-4 py-1.5 rounded-full text-sm font-bold"
              style={{ background: "#f59e0b", color: "#1c1007" }}
            >
              🌟 {company.sponsor_level || (isEN ? "Sponsor" : "حامی")}
            </span>
          </div>
        )}

        {/* Name section */}
        {(company.brand_name_fa || company.brand_name_en || company.legal_name_fa || company.legal_name_en) && (
          <Section title={isEN ? "Company Name" : "نام شرکت"}>
            {company.brand_name_fa && (
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--text)", direction: "rtl" }}>
                {company.brand_name_fa}
              </p>
            )}
            {company.brand_name_en && (
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--text)", direction: "ltr" }}>
                {company.brand_name_en}
              </p>
            )}
            {(company.legal_name_fa || company.legal_name_en) && (
              <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                {isEN
                  ? (company.legal_name_en || company.legal_name_fa)
                  : (company.legal_name_fa || company.legal_name_en)}
              </p>
            )}
          </Section>
        )}

        {/* Description */}
        {description && (
          <Section title={isEN ? "About" : "درباره شرکت"}>
            <p
              className="text-sm leading-7"
              style={{ color: "var(--text)", direction: isEN ? "ltr" : "rtl" }}
            >
              {description}
            </p>
          </Section>
        )}

        {/* Website */}
        {company.website && (
          <Section title={isEN ? "Website" : "وبسایت"}>
            <a
              href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm flex items-center gap-2"
              style={{ color: "var(--accent)", direction: "ltr", wordBreak: "break-all" }}
            >
              <span>🔗</span>
              <span>{company.website.replace(/^https?:\/\//, "")}</span>
            </a>
          </Section>
        )}

        {/* Contact */}
        {(phones.length > 0 || emails.length > 0) && (
          <Section title={isEN ? "Contact" : "ارتباط"}>
            {phones.map((phone, i) => (
              <a
                key={i}
                href={`tel:${phone}`}
                className="flex items-center gap-2 text-sm mb-2"
                style={{ color: "var(--text)", direction: "ltr" }}
              >
                <span style={{ color: "var(--accent)" }}>📞</span>
                <span>{isRTL ? toPersianDigits(phone) : phone}</span>
              </a>
            ))}
            {emails.map((email, i) => (
              <a
                key={i}
                href={`mailto:${email}`}
                className="flex items-center gap-2 text-sm mb-2"
                style={{ color: "var(--text)", direction: "ltr", wordBreak: "break-all" }}
              >
                <span style={{ color: "var(--accent)" }}>✉️</span>
                <span>{email}</span>
              </a>
            ))}
          </Section>
        )}

        {/* Booth location */}
        {company.hall_name && company.booth_no && (
          <Section title={isEN ? "Booth Location" : "موقعیت غرفه"}>
            <p className="text-sm font-medium" style={{ color: "var(--text)", direction: "ltr" }}>
              📍{" "}
              {isEN
                ? `Hall ${company.hall_name}, Booth ${company.booth_no}`
                : `سالن ${company.hall_name}، غرفه ${toPersianDigits(company.booth_no)}`}
            </p>
          </Section>
        )}

        {/* Address */}
        {address && (
          <Section title={isEN ? "Address" : "آدرس"}>
            <p
              className="text-sm leading-7"
              style={{ color: "var(--text)", direction: isEN ? "ltr" : "rtl" }}
            >
              {address}
            </p>
          </Section>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
