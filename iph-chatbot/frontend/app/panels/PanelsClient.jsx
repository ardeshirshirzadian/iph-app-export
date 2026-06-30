"use client";

import { useState, useEffect } from "react";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { toPersianDigits } from "@/lib/utils";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

// ── Date helpers ─────────────────────────────────────────────────────────────

function formatDate(isoStr, lang) {
  if (!isoStr) return "";
  try {
    if (lang === "fa") {
      return new Date(isoStr).toLocaleDateString("fa-IR-u-ca-persian", {
        month: "long",
        day: "numeric",
      });
    }
    return new Date(isoStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch { return ""; }
}

function formatDateShort(isoStr, lang) {
  if (!isoStr) return "";
  try {
    if (lang === "fa") {
      return new Date(isoStr).toLocaleDateString("fa-IR-u-ca-persian", {
        month: "short",
        day: "numeric",
      });
    }
    return new Date(isoStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch { return ""; }
}

function formatTime(isoStr, lang) {
  if (!isoStr) return "";
  try {
    const locale = lang === "fa" ? "fa-IR" : "en-US";
    return new Date(isoStr).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch { return ""; }
}

function isoDateOnly(isoStr) {
  if (!isoStr) return "";
  return isoStr.slice(0, 10);
}

// ── Thumbnail URL ─────────────────────────────────────────────────────────────

function getThumbnailUrl(thumbnail, baseUrl) {
  if (!thumbnail) return null;
  if (typeof thumbnail === "string") return baseUrl + thumbnail;
  const path =
    thumbnail.url || thumbnail.original || thumbnail.medium ||
    thumbnail.thumbnail || thumbnail.path ||
    thumbnail.jpg?.original || thumbnail.jpg?.medium || thumbnail.jpg?.["128"];
  return path ? baseUrl + path : null;
}

// ── Kind badge labels ─────────────────────────────────────────────────────────

function kindLabel(kind, lang) {
  if (!kind) return null;
  const key = `kind_${kind.toLowerCase()}`;
  const translated = t(lang, key);
  return translated !== key ? translated : kind;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function PanelSkeleton() {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div
        className="w-full animate-pulse"
        style={{ aspectRatio: "16/7", background: "rgba(255,255,255,0.04)" }}
      />
      <div className="p-4 flex flex-col gap-2">
        <div className="rounded animate-pulse" style={{ height: 14, width: "80%", background: "rgba(255,255,255,0.06)" }} />
        <div className="rounded animate-pulse" style={{ height: 11, width: "50%", background: "rgba(255,255,255,0.04)" }} />
        <div className="rounded animate-pulse" style={{ height: 11, width: "40%", background: "rgba(255,255,255,0.04)" }} />
      </div>
    </div>
  );
}

// ── Panel card ────────────────────────────────────────────────────────────────

function PanelCard({ panel, visibleFields, logoBaseUrl, lang }) {
  const thumbUrl = visibleFields.thumbnail
    ? getThumbnailUrl(panel.thumbnail, logoBaseUrl)
    : null;

  const speakers = Array.isArray(panel.speakers) ? panel.speakers : [];
  const label = kindLabel(panel.kind, lang);

  const capacityText = panel.capacity
    ? lang === "fa"
      ? `${t(lang, "panel_capacity")}: ${toPersianDigits(panel.capacity)} ${t(lang, "panel_person_unit")}`
      : `${t(lang, "panel_capacity")}: ${panel.capacity}`
    : null;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {thumbUrl && (
        <div
          className="w-full overflow-hidden"
          style={{ aspectRatio: "16/7", background: "rgba(0,0,0,0.2)" }}
        >
          <img
            src={thumbUrl}
            alt={panel.title_fa || ""}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1 min-w-0">
            {visibleFields.kind && label && (
              <span
                className="inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-1.5"
                style={{
                  background: panel.kind === "workshop"
                    ? "rgba(139,92,246,0.15)"
                    : "rgba(0,255,179,0.1)",
                  color: panel.kind === "workshop" ? "#c4b5fd" : "var(--accent)",
                  border: `1px solid ${panel.kind === "workshop" ? "rgba(139,92,246,0.3)" : "rgba(0,255,179,0.2)"}`,
                }}
              >
                {label}
              </span>
            )}
            <h3
              className="text-sm font-bold leading-snug"
              style={{ color: "var(--text)" }}
            >
              {panel.title_fa || panel.title_en}
            </h3>
          </div>
        </div>

        {panel.starts_at && (
          <div
            className="flex items-center gap-1.5 text-xs mb-2"
            style={{ color: "var(--accent)" }}
          >
            <span>📅</span>
            <span>{formatDate(panel.starts_at, lang)}</span>
            <span style={{ color: "var(--text-dim)" }}>·</span>
            <span style={{ color: "var(--text-muted)", direction: "ltr" }}>
              {formatTime(panel.starts_at, lang)}
              {panel.ends_at && ` – ${formatTime(panel.ends_at, lang)}`}
            </span>
          </div>
        )}

        {visibleFields.hall_fa && panel.hall_fa && (
          <div
            className="flex items-center gap-1.5 text-xs mb-2"
            style={{ color: "var(--text-muted)" }}
          >
            <span>📍</span>
            <span>{panel.hall_fa}</span>
          </div>
        )}

        {visibleFields.capacity && panel.capacity && capacityText && (
          <div
            className="flex items-center gap-1.5 text-xs mb-2"
            style={{ color: "var(--text-muted)" }}
          >
            <span>👥</span>
            <span>{capacityText}</span>
          </div>
        )}

        {visibleFields.description_fa && panel.description_fa && (
          <p
            className="text-xs leading-relaxed mb-3"
            style={{
              color: "var(--text-muted)",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {panel.description_fa}
          </p>
        )}

        {visibleFields.speakers && speakers.length > 0 && (
          <div
            className="pt-3"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <p
              className="text-xs font-medium mb-2"
              style={{ color: "var(--text-dim)" }}
            >
              {t(lang, "panel_speakers_label")}
            </p>
            <div className="flex flex-wrap gap-2">
              {speakers.map((sp, i) => {
                const name =
                  (sp.firstname_fa ? sp.firstname_fa + " " + (sp.lastname_fa || "") : null) ||
                  (sp.firstname_en ? sp.firstname_en + " " + (sp.lastname_en || "") : null) ||
                  t(lang, "panel_speaker_fallback");
                const initial = (sp.firstname_fa || sp.firstname_en || "؟").charAt(0);
                return (
                  <div key={sp.id || i} className="flex items-center gap-1.5">
                    <div
                      className="flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0"
                      style={{
                        width: 26, height: 26,
                        background: "color-mix(in srgb, var(--accent) 15%, transparent)",
                        border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
                        color: "var(--accent)",
                      }}
                    >
                      {initial}
                    </div>
                    <div>
                      <p className="text-xs font-medium" style={{ color: "var(--text)" }}>
                        {name.trim()}
                      </p>
                      {sp.job_title_fa && (
                        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {sp.job_title_fa}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Filter pill ───────────────────────────────────────────────────────────────

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PanelsClient({ title, subtitle, title_en, subtitle_en }) {
  const [panels, setPanels] = useState([]);
  const [halls, setHalls] = useState([]);
  const [dates, setDates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedHall, setSelectedHall] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [visibleFields, setVisibleFields] = useState({});
  const [logoBaseUrl, setLogoBaseUrl] = useState("");
  const [eventNameEn, setEventNameEn] = useState("");
  const { lang, isRTL } = useLang();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      search: debouncedSearch,
      hall: selectedHall,
      date: selectedDate,
    });
    fetch(`/api/panels?${params}`)
      .then(r => r.json())
      .then(data => {
        setPanels(data.panels ?? []);
        setHalls(data.halls ?? []);
        setDates(data.dates ?? []);
        setVisibleFields(data.visibleFields ?? {});
        setLogoBaseUrl(data.logoBaseUrl ?? "");
        setEventNameEn(data.eventNameEn ?? "");
      })
      .catch(() => setPanels([]))
      .finally(() => setLoading(false));
  }, [debouncedSearch, selectedHall, selectedDate]);

  const isEmpty = !loading && panels.length === 0;
  const showDateFilter = dates.length > 1;
  const showHallFilter = halls.length > 1;

  const panelCountLabel = lang === "fa"
    ? `${toPersianDigits(panels.length)} ${t(lang, "panels_count_suffix")}`
    : `${panels.length} ${t(lang, "panels_count_suffix")}`;

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
          placeholder={t(lang, "panels_search")}
          className="w-full rounded-2xl px-4 py-3 text-sm outline-none mb-3"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            fontFamily: "inherit",
          }}
        />

        {showDateFilter && (
          <div
            className="flex gap-2 pb-1 mb-2 overflow-x-auto"
            style={{ scrollbarWidth: "none" }}
          >
            <FilterPill
              label={t(lang, "panels_all_days")}
              active={selectedDate === ""}
              onClick={() => setSelectedDate("")}
            />
            {dates.map(d => (
              <FilterPill
                key={d}
                label={formatDateShort(d + "T00:00:00", lang)}
                active={selectedDate === d}
                onClick={() => setSelectedDate(selectedDate === d ? "" : d)}
              />
            ))}
          </div>
        )}

        {showHallFilter && (
          <div
            className="flex gap-2 pb-1 mb-3 overflow-x-auto"
            style={{ scrollbarWidth: "none" }}
          >
            <FilterPill
              label={t(lang, "panels_all_halls")}
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

        {!loading && panels.length > 0 && (
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            {panelCountLabel}
          </p>
        )}

        {loading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, i) => <PanelSkeleton key={i} />)}
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
            <div className="text-4xl mb-3">🎤</div>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
              {debouncedSearch || selectedHall || selectedDate
                ? t(lang, "panels_no_results")
                : t(lang, "panels_empty")}
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {debouncedSearch || selectedHall || selectedDate
                ? t(lang, "panels_try_other")
                : t(lang, "panels_sync_hint")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {panels.map(p => (
              <PanelCard
                key={p.id}
                panel={p}
                visibleFields={visibleFields}
                logoBaseUrl={logoBaseUrl}
                lang={lang}
              />
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
