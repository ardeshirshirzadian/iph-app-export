"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "@/app/components/BottomNav";
import AppHeader from "@/app/components/AppHeader";
import { useLang } from "@/lib/useLang";
import { toPersianDigits } from "@/lib/utils";

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

export default function CompanyDetailClient({ company, logoBaseUrl }) {
  const { lang, isRTL } = useLang();
  const router = useRouter();
  const [imgError, setImgError] = useState(false);

  const isEN = lang === "en";
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
      <div className="fixed top-0 right-0 w-72 h-72 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(0,255,179,0.04)", zIndex: 0 }} />
      <div className="fixed bottom-0 left-0 w-80 h-80 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(5,64,65,0.5)", zIndex: 0 }} />

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
