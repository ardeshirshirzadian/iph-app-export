"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import { useLang } from "@/lib/useLang";
import { toPersianDigits } from "@/lib/utils";
import { buildWalkableGrid, findGridRoute, pathLength } from "@/lib/mapPathfinding";

const RASAYESH_BASE = "https://api.rasayesh.com/";
const DRAG_THRESHOLD = 6; // px movement before a touch is treated as a drag (not a tap)

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLogoUrl(logo) {
  if (!logo) return null;
  const src =
    logo?.jpg?.["64"] || logo?.jpg?.["32"] ||
    logo?.png?.["64"] || logo?.png?.["32"] ||
    logo?.webp?.["64"] || logo?.webp?.["32"] ||
    logo?.["64"] || logo?.["32"];
  return src ? RASAYESH_BASE + src : null;
}

function getPlanUrl(bare_plan) {
  if (!bare_plan) return null;
  if (typeof bare_plan === "string") return RASAYESH_BASE + bare_plan;
  // handle nested object formats {jpg: {512: "path"}} or {svg: "path"}
  const fmt = bare_plan?.svg ?? bare_plan?.png ?? bare_plan?.jpg ?? bare_plan?.webp;
  if (typeof fmt === "string") return RASAYESH_BASE + fmt;
  if (fmt && typeof fmt === "object") return RASAYESH_BASE + Object.values(fmt)[0];
  return null;
}

function getMapDim(map_bounds) {
  if (!map_bounds) return { w: 1000, h: 700 };
  if (Array.isArray(map_bounds)) {
    const xs = map_bounds.map((p) => p.x);
    const ys = map_bounds.map((p) => p.y);
    return { w: Math.max(...xs), h: Math.max(...ys) };
  }
  // single {x, y} object — interpret as canvas dimensions
  return { w: map_bounds.x || 1000, h: map_bounds.y || 700 };
}

function toPoints(bounds) {
  if (!Array.isArray(bounds) || bounds.length === 0) return "";
  return bounds.map((p) => `${p.x},${p.y}`).join(" ");
}

// Returns the corrected polygon points as an array — handles 2-point bounding-box
// format (expands to rectangle) and angle-sorts 3+ points from centroid.
function hallToPointsArray(bounds) {
  if (!Array.isArray(bounds) || bounds.length < 2) return [];
  if (bounds.length === 2) {
    const [a, b] = bounds;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }
  const cx = bounds.reduce((s, p) => s + p.x, 0) / bounds.length;
  const cy = bounds.reduce((s, p) => s + p.y, 0) / bounds.length;
  return [...bounds].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
}

function hallToPoints(bounds) {
  return hallToPointsArray(bounds).map((p) => `${p.x},${p.y}`).join(" ");
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// True polygon centroid via shoelace formula — correct for any convex/concave polygon.
// Falls back to arithmetic mean for degenerate cases.
function polygonCentroid(pts) {
  if (!pts || !pts.length) return null;
  const n = pts.length;
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    area += cross;
    cx += (pts[i].x + pts[j].x) * cross;
    cy += (pts[i].y + pts[j].y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-10) {
    return { cx: pts.reduce((s, p) => s + p.x, 0) / n, cy: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  return { cx: cx / (6 * area), cy: cy / (6 * area) };
}

function polyCenter(points) {
  if (!Array.isArray(points) || !points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

function buildBoothGroups(booths) {
  const companyMap = new Map();
  const result = [];
  for (const booth of booths) {
    if (!booth.company) {
      result.push({ type: "vacant", booths: [booth], company: null });
      continue;
    }
    const cid = booth.company.id;
    if (!companyMap.has(cid)) companyMap.set(cid, []);
    companyMap.get(cid).push(booth);
  }
  for (const [, bths] of companyMap) {
    const sorted = [...bths].sort((a, b) => {
      const na = parseInt(a.no, 10), nb = parseInt(b.no, 10);
      return isNaN(na) || isNaN(nb) ? String(a.no).localeCompare(String(b.no)) : na - nb;
    });
    result.push({ type: sorted.length > 1 ? "merged" : "single", booths: sorted, company: sorted[0].company });
  }
  return result;
}

function boothRangeLabel(nos) {
  const strs = (nos ?? []).map(String).filter(Boolean);
  if (!strs.length) return "";
  if (strs.length === 1) return strs[0];
  const nums = strs.map((s) => parseInt(s, 10));
  if (nums.every((n) => !isNaN(n))) {
    const sorted = [...nums].sort((a, b) => a - b);
    if (sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1))
      return `${sorted[0]}-${sorted[sorted.length - 1]}`;
    return sorted.join(", ");
  }
  return [...strs].sort().join(", ");
}

// CHANGE 3-B: Module-level constants/helpers (no hooks — safe outside component)
const PRESET_ICONS = {
  exit: "🚪", entrance: "🚶", wc: "🚻", cafe: "☕",
  restaurant: "🍽️", prayer: "🕌", mic: "🎤", info: "ℹ️",
  medical: "🏥", parking: "🅿️",
};
function getElementEmoji(el) {
  if (el.icon_type === "preset") return PRESET_ICONS[el.icon_value] || "📍";
  return el.icon_value || "📍";
}
function getHallColor(hall, hallColors) {
  return hallColors[hall.name] || hall.color || "#00ffb3";
}

// ── Search Bar ────────────────────────────────────────────────────────────────

function MapSearchBar({ query, setQuery, open, setOpen, results, onSelect, destName, onClearDest, lang, isRTL }) {
  const isEN = lang === "en";
  return (
    <div
      className="absolute z-[25]"
      style={{ top: 8, left: 8, right: 8 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-2"
        style={{
          background: "rgba(2,20,21,0.96)", backdropFilter: "blur(20px)",
          border: "1px solid rgba(0,255,179,0.28)", borderRadius: 14,
          padding: "10px 14px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
        }}
      >
        <span style={{ fontSize: 15, opacity: 0.55 }}>🔍</span>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={isEN ? "Search booths and facilities…" : "جستجوی غرفه یا امکانات…"}
          style={{
            flex: 1, background: "none", border: "none", outline: "none",
            color: "var(--text)", fontFamily: "inherit", fontSize: 14,
            direction: isRTL ? "rtl" : "ltr",
          }}
        />
        {(query || destName) && (
          <button
            onClick={() => { setQuery(""); setOpen(false); onClearDest(); }}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0, fontFamily: "inherit" }}
          >×</button>
        )}
      </div>
      {destName && !open && (
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--accent)", paddingInlineStart: 4 }}>
          📍 {destName}
        </div>
      )}
      {open && results.length > 0 && (
        <div
          style={{
            marginTop: 4, background: "rgba(2,20,21,0.98)", backdropFilter: "blur(20px)",
            border: "1px solid rgba(0,255,179,0.18)", borderRadius: 12,
            maxHeight: 260, overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
          }}
        >
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", background: "none", border: "none",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                cursor: "pointer", textAlign: isRTL ? "right" : "left", fontFamily: "inherit",
              }}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>
                {r.type === "element" ? r.emoji : "🏪"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {isEN ? (r.nameEn || r.name) : r.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {r.type === "booth"
                    ? `${isEN ? "Hall" : "سالن"} ${r.hall} · ${isEN ? "Booth" : "غرفه"} ${r.no}`
                    : (isEN ? (r.nameEn || r.name) : r.name)}
                </div>
              </div>
              <span style={{ fontSize: 11, color: "var(--accent)", opacity: 0.7, flexShrink: 0 }}>
                {isEN ? "Route" : "مسیریابی"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Start Point Panel ─────────────────────────────────────────────────────────

function StartPanel({ lang, isRTL, onTapMode, onScanMode, startQuery, setStartQuery, startResults, onSelectStart, onCancel, scanActive, videoRef }) {
  const isEN = lang === "en";
  return (
    <div className="fixed inset-0 z-[58] flex flex-col justify-end" style={{ direction: isRTL ? "rtl" : "ltr" }}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.42)" }} onClick={onCancel} />
      <div
        className="relative"
        style={{
          background: "rgba(2,20,21,0.98)", backdropFilter: "blur(28px)",
          borderTop: "1px solid rgba(0,255,179,0.2)", borderRadius: "24px 24px 0 0",
          padding: "16px 20px", paddingBottom: "calc(1.2rem + env(safe-area-inset-bottom))",
          maxHeight: "80vh", overflowY: "auto",
        }}
      >
        <div className="flex justify-center mb-4">
          <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.18)", borderRadius: 2 }} />
        </div>
        <p style={{ fontWeight: 700, fontSize: 16, color: "var(--text)", marginBottom: 4 }}>
          {isEN ? "Where are you starting from?" : "نقطه شروع را انتخاب کنید"}
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
          {isEN ? "Pick your current location on the map." : "موقعیت فعلی خود را مشخص کنید."}
        </p>

        {/* Quick-pick buttons */}
        <div className="flex gap-3 mb-5">
          <button
            onClick={onTapMode}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              padding: "14px 8px", background: "rgba(0,255,179,0.07)",
              border: "1px solid rgba(0,255,179,0.3)", borderRadius: 14,
              cursor: "pointer", fontFamily: "inherit", color: "var(--accent)",
            }}
          >
            <span style={{ fontSize: 24 }}>📍</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{isEN ? "Tap on map" : "روی نقشه بزنید"}</span>
          </button>
          <button
            onClick={onScanMode}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              padding: "14px 8px",
              background: scanActive ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${scanActive ? "rgba(59,130,246,0.6)" : "rgba(255,255,255,0.12)"}`,
              borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
              color: scanActive ? "#60a5fa" : "var(--text)",
            }}
          >
            <span style={{ fontSize: 24 }}>📷</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{isEN ? "Scan QR" : "اسکن QR"}</span>
          </button>
        </div>

        {/* Inline QR video */}
        {scanActive && (
          <div className="mb-4">
            <video
              ref={videoRef}
              style={{ width: "100%", borderRadius: 12, background: "#000", aspectRatio: "4/3", objectFit: "cover", display: "block" }}
              playsInline muted
            />
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, textAlign: "center" }}>
              {isEN ? "Point camera at a booth QR code" : "دوربین را روی QR غرفه بگیرید"}
            </p>
          </div>
        )}

        {/* Search list */}
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          {isEN ? "Or search for a booth / location:" : "یا از لیست انتخاب کنید:"}
        </p>
        <input
          value={startQuery}
          onChange={(e) => setStartQuery(e.target.value)}
          placeholder={isEN ? "Search…" : "جستجو…"}
          style={{
            width: "100%", boxSizing: "border-box",
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10, padding: "9px 12px", fontSize: 13,
            color: "var(--text)", fontFamily: "inherit", outline: "none",
            direction: isRTL ? "rtl" : "ltr", marginBottom: 4,
          }}
        />
        {startResults.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelectStart(r)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "9px 4px", background: "none", border: "none",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              cursor: "pointer", textAlign: isRTL ? "right" : "left", fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: 18 }}>{r.type === "element" ? r.emoji : "🏪"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
              {r.type === "booth" && (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{isEN ? "Hall" : "سالن"} {r.hall}</div>
              )}
            </div>
          </button>
        ))}

        <button
          onClick={onCancel}
          style={{
            marginTop: 14, width: "100%", padding: "11px",
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10, color: "var(--text-muted)", fontFamily: "inherit", fontSize: 13, cursor: "pointer",
          }}
        >
          {isEN ? "Cancel" : "لغو"}
        </button>
      </div>
    </div>
  );
}

// ── Route Info Card ────────────────────────────────────────────────────────────

function RouteInfoCard({ path, lang, isRTL, onClear }) {
  if (!path || path.length < 2) return null;
  const dist = pathLength(path);
  // ~15 SVG units ≈ 1 m (approximate based on typical exhibition booth dimensions)
  const meters = Math.max(1, Math.round(dist / 15));
  const minutes = Math.max(1, Math.round(meters / 72)); // 1.2 m/s walking
  const isEN = lang === "en";
  return (
    <div
      className="absolute z-[20]"
      style={{
        bottom: 56, left: 8, right: 8,
        background: "rgba(2,20,21,0.96)", backdropFilter: "blur(16px)",
        border: "1px solid rgba(0,255,179,0.3)", borderRadius: 16,
        padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
        boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
        direction: isRTL ? "rtl" : "ltr",
      }}
    >
      <span style={{ fontSize: 22 }}>🧭</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>
          {isEN ? `≈ ${meters} m · ${minutes} min` : `≈ ${meters} متر · ${toPersianDigits(minutes)} دقیقه`}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {isEN ? "Estimated walking time" : "زمان تقریبی پیاده‌روی"}
        </div>
      </div>
      <button
        onClick={onClear}
        style={{
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8, padding: "6px 12px", color: "var(--text-muted)",
          fontFamily: "inherit", fontSize: 12, cursor: "pointer",
        }}
      >
        {isEN ? "Clear" : "حذف مسیر"}
      </button>
    </div>
  );
}

// ── Booth Bottom Sheet ─────────────────────────────────────────────────────────

function BoothSheet({ booth, hall, mergedLabel, lang, isRTL, onClose }) {
  const isEN = lang === "en";
  const co = booth.company;
  const logoUrl = getLogoUrl(co?.logo);
  const brandName = isEN
    ? (co?.brand_name_en || co?.brand_name_fa)
    : (co?.brand_name_fa || co?.brand_name_en);
  const sponsor = co?.sponsorshipLevels?.[0];
  const fields = (co?.field_of_activities ?? []).slice(0, 3);
  const canProfile = co?.slug && co?.eventOptions?.show_profile !== false;
  const displayNo = mergedLabel || String(booth.no);
  const hallBooth = isEN
    ? `Hall ${hall.name} · Booth${mergedLabel ? "s" : ""} ${displayNo}`
    : `سالن ${hall.name} · غرفه ${toPersianDigits(displayNo)}`;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[55] rounded-t-3xl"
      style={{
        background: "rgba(2,20,21,0.97)",
        backdropFilter: "blur(28px)",
        borderTop: "1px solid rgba(0,255,179,0.25)",
        paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom))",
        maxHeight: "72vh",
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* drag handle */}
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
      </div>

      <div className="px-5 pb-2">
        {/* company header */}
        <div className="flex items-start gap-4 mb-4">
          <div
            className="flex-shrink-0 rounded-2xl flex items-center justify-center overflow-hidden"
            style={{
              width: 64, height: 64,
              background: logoUrl ? "#fff" : "rgba(0,255,179,0.08)",
              border: "1px solid rgba(0,255,179,0.2)",
            }}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" style={{ width: "80%", height: "80%", objectFit: "contain" }} />
            ) : (
              <span style={{ fontSize: 28, color: "var(--accent)" }}>
                {co?.brand_name_fa?.charAt(0) || co?.brand_name_en?.charAt(0) || "؟"}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0 pt-1">
            <p className="font-bold text-base leading-snug" style={{ color: "var(--text)" }}>
              {brandName || (isEN ? "Company" : "شرکت")}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--accent)" }}>
              📍 {hallBooth}
            </p>
            {sponsor && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold mt-1.5"
                style={{ background: sponsor.color || "#f59e0b", color: "#1c1007" }}
              >
                {sponsor.icon?.startsWith("<svg")
                  ? <span dangerouslySetInnerHTML={{ __html: sponsor.icon }} style={{ width: 14, height: 14, display: "inline-flex", alignItems: "center", verticalAlign: "middle", flexShrink: 0, overflow: "hidden" }} />
                  : (sponsor.icon || "🌟")}{" "}
                {isEN ? (sponsor.title_en || sponsor.title_fa || "Sponsor") : (sponsor.title_fa || "حامی")}
              </span>
            )}
          </div>
        </div>

        {/* field of activities */}
        {fields.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {fields.map((f, i) => (
              <span
                key={i}
                className="px-2.5 py-0.5 rounded-full text-xs"
                style={{
                  background: "rgba(0,255,179,0.08)",
                  color: "var(--accent)",
                  border: "1px solid rgba(0,255,179,0.15)",
                }}
              >
                {isEN ? (f.title_en || f.title_fa) : (f.title_fa || f.title_en)}
              </span>
            ))}
          </div>
        )}

        {/* actions */}
        <div className="flex gap-2">
          {canProfile && (
            <Link
              href={`/companies/${co.slug}`}
              className="flex-1 py-3 rounded-xl font-bold text-sm text-center transition-all active:scale-95"
              style={{ background: "var(--accent)", color: "#021f20" }}
              onClick={onClose}
            >
              {isEN ? "View Profile" : "مشاهده پروفایل"}
            </Link>
          )}
          <button
            onClick={onClose}
            className="px-5 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--text-muted)",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {isEN ? "Close" : "بستن"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sign Tooltip ───────────────────────────────────────────────────────────────

function SignTooltip({ sign, sx, sy, lang }) {
  const isEN = lang === "en";
  const title = isEN ? (sign.title_en || sign.title_fa) : (sign.title_fa || sign.title_en);
  const safeX = typeof window !== "undefined" ? clamp(sx, 8, window.innerWidth - 160) : sx;
  const safeY = Math.max(sy - 52, 8);
  return (
    <div
      className="fixed z-[57] px-3 py-2 rounded-xl text-sm font-medium pointer-events-none whitespace-nowrap"
      style={{
        left: safeX, top: safeY,
        background: "rgba(2,31,32,0.96)",
        border: "1px solid rgba(0,255,179,0.35)",
        color: "var(--text)",
        backdropFilter: "blur(16px)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      }}
    >
      {sign.icon || "📍"} {title}
    </div>
  );
}

// CHANGE 4-C: Map Element Tooltip
function MapElementTooltip({ el, sx, sy, lang }) {
  const isEN = lang === "en";
  const title = isEN ? (el.title_en || el.title_fa) : (el.title_fa || el.title_en);
  const safeX = typeof window !== "undefined" ? clamp(sx, 8, window.innerWidth - 160) : sx;
  const safeY = Math.max(sy - 52, 8);
  return (
    <div
      className="fixed z-[57] px-3 py-2 rounded-xl text-sm font-medium pointer-events-none whitespace-nowrap"
      style={{
        left: safeX, top: safeY,
        background: "rgba(2,31,32,0.96)",
        border: "1px solid rgba(59,130,246,0.45)",
        color: "var(--text)",
        backdropFilter: "blur(16px)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      }}
    >
      {getElementEmoji(el)} {title}
    </div>
  );
}

// CHANGE 4-E: Map Legend component
function MapLegend({ elements, lang }) {
  const [open, setOpen] = useState(false);
  const isEN = lang === "en";
  return (
    <div
      className="absolute z-[15] rounded-xl overflow-hidden"
      style={{
        bottom: 56, left: 12,
        background: "rgba(2,20,21,0.92)",
        border: "1px solid rgba(0,255,179,0.2)",
        backdropFilter: "blur(12px)",
        minWidth: 120,
        maxWidth: 200,
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold"
        style={{ color: "var(--accent)", fontFamily: "inherit", cursor: "pointer", background: "none", border: "none" }}
      >
        <span>🗺</span>
        <span>{isEN ? "Legend" : "راهنما"}</span>
        <span style={{ marginRight: "auto", opacity: 0.6 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-1.5">
          {elements.map((el) => (
            <div key={el.id} className="flex items-center gap-2 text-xs" style={{ color: "var(--text)" }}>
              <span style={{ fontSize: 14 }}>{getElementEmoji(el)}</span>
              <span>{isEN ? (el.title_en || el.title_fa) : (el.title_fa || el.title_en)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Loading Skeleton ───────────────────────────────────────────────────────────

function MapSkeleton() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
      <div className="flex gap-2">
        {[40, 60, 40].map((w, i) => (
          <div
            key={i}
            className="rounded-xl animate-pulse"
            style={{ width: w, height: 40, background: "rgba(0,255,179,0.08)" }}
          />
        ))}
      </div>
      <div className="w-48 h-4 rounded-full animate-pulse" style={{ background: "rgba(255,255,255,0.06)" }} />
      <p className="text-sm" style={{ color: "var(--text-dim)" }}>در حال بارگذاری نقشه...</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function MapClient({ title, subtitle, title_en, subtitle_en }) {
  const { lang, isRTL } = useLang();
  const isEN = lang === "en";

  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // null | string
  const [selectedBooth, setSelectedBooth] = useState(null); // { booth, hall }
  const [signTooltip, setSignTooltip] = useState(null); // { sign, sx, sy }
  // CHANGE 3-A: new state for hall colors, map elements, element tooltip
  const [hallColors, setHallColors] = useState({});
  const [mapElements, setMapElements] = useState([]);
  const [elementTooltip, setElementTooltip] = useState(null); // { el, sx, sy }

  // Navigation state
  const [navDest, setNavDest] = useState(null);       // { x, y, name }
  const [navStart, setNavStart] = useState(null);     // { x, y }
  const [navPath, setNavPath] = useState(null);       // [{x,y}] computed route
  const [startPanelOpen, setStartPanelOpen] = useState(false);
  const [tapStartMode, setTapStartMode] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [startQuery, setStartQuery] = useState("");

  // QR scanner
  const [scanActive, setScanActive] = useState(false);
  const qrVideoRef = useRef(null);
  const qrControlsRef = useRef(null);

  const containerRef = useRef(null);
  const wrapperRef = useRef(null); // receives CSS transform
  const tRef = useRef({ x: 0, y: 0, scale: 1 }); // live transform (no state, direct DOM)
  const minScaleRef = useRef(0.05);
  const maxScaleRef = useRef(4);
  const dimRef = useRef({ w: 1000, h: 700 });
  const gridRef = useRef(null); // walkable grid, built once per map load

  // drag / pinch ephemeral state — never in React state
  const dragRef = useRef({ on: false, lx: 0, ly: 0, sx: 0, sy: 0, moved: false });
  const pinchRef = useRef({ on: false, d0: 0, s0: 1 });

  // label rendering refs
  const fitScaleRef = useRef(1);
  const boothLabelsWrapRef = useRef(null);

  // ── Transform helpers ──────────────────────────────────────────────────────

  function applyT(x, y, scale) {
    tRef.current = { x, y, scale };
    if (wrapperRef.current) {
      wrapperRef.current.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    }
    // Booth numbers: update CSS var (font-size cancels scale) + visibility threshold
    if (boothLabelsWrapRef.current) {
      boothLabelsWrapRef.current.style.setProperty("--map-s", scale);
      const show = fitScaleRef.current > 0 && scale > fitScaleRef.current * 1.8;
      boothLabelsWrapRef.current.style.opacity = show ? "1" : "0";
    }
  }

  function clampPan(x, y, scale) {
    const el = containerRef.current;
    if (!el) return { x, y };
    const { w, h } = dimRef.current;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const sw = w * scale;
    const sh = h * scale;
    // if scaled map fits inside container, center it; otherwise clamp to edges
    const nx = sw <= cw ? (cw - sw) / 2 : clamp(x, cw - sw, 0);
    const ny = sh <= ch ? (ch - sh) / 2 : clamp(y, ch - sh, 0);
    return { x: nx, y: ny };
  }

  function resetView(dim) {
    const el = containerRef.current;
    if (!el) return;
    const { w, h } = dim ?? dimRef.current;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const fit = Math.min(cw / w, ch / h);
    fitScaleRef.current = fit;
    minScaleRef.current = fit * 0.45;
    maxScaleRef.current = fit * 5;
    const { x, y } = clampPan((cw - w * fit) / 2, (ch - h * fit) / 2, fit);
    applyT(x, y, fit);
  }

  // ── Data fetch ─────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/map")
      .then((r) => r.json())
      .then((d) => {
        // CHANGE 3-C: also extract hallColors and mapElements
        if (d.errors?.length) {
          console.error("[MapClient] GraphQL errors:", d.errors);
          setError("GraphQL: " + d.errors[0].message);
          return;
        }
        if (!d.websiteEvent) { setError("no_data"); return; }
        const dim = getMapDim(d.websiteEvent.map_bounds);
        dimRef.current = dim;
        setMapData(d.websiteEvent);
        if (d.hallColors) setHallColors(d.hallColors);
        if (d.mapElements) setMapElements(d.mapElements);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // fit map to screen once data + DOM are ready
  useEffect(() => {
    if (!mapData) return;
    requestAnimationFrame(() => resetView(dimRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapData]);

  // build walkable grid once per map load (fast: O(booths) spatial marking)
  useEffect(() => {
    if (!mapData) return;
    const allBooths = (mapData.halls ?? []).flatMap(h => h.booths ?? []);
    const { w, h } = dimRef.current;
    gridRef.current = buildWalkableGrid(w, h, allBooths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapData]);

  // CHANGE 1: Consolidated non-passive event listeners (pointer + touchmove + wheel)
  // [] dependency — all handlers read only refs, no stale closures

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onPointerDown(e) {
      if (e.pointerType === "touch") return;
      dragRef.current = { on: true, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
      el.setPointerCapture(e.pointerId);
      setSignTooltip(null);
      if (wrapperRef.current) wrapperRef.current.style.willChange = "transform";
    }
    function onPointerMove(e) {
      if (e.pointerType === "touch" || !dragRef.current.on) return;
      const dx = e.clientX - dragRef.current.lx;
      const dy = e.clientY - dragRef.current.ly;
      dragRef.current.lx = e.clientX;
      dragRef.current.ly = e.clientY;
      if (Math.hypot(e.clientX - dragRef.current.sx, e.clientY - dragRef.current.sy) > DRAG_THRESHOLD)
        dragRef.current.moved = true;
      const { x, y, scale } = tRef.current;
      const c = clampPan(x + dx, y + dy, scale);
      applyT(c.x, c.y, scale);
    }
    function onPointerUp(e) {
      if (e.pointerType === "touch") return;
      dragRef.current.on = false;
      if (wrapperRef.current) wrapperRef.current.style.willChange = "auto";
    }
    function onTouchMove(e) {
      e.preventDefault();
      if (e.touches.length === 1 && dragRef.current.on) {
        const dx = e.touches[0].clientX - dragRef.current.lx;
        const dy = e.touches[0].clientY - dragRef.current.ly;
        dragRef.current.lx = e.touches[0].clientX;
        dragRef.current.ly = e.touches[0].clientY;
        const tdx = e.touches[0].clientX - dragRef.current.sx;
        const tdy = e.touches[0].clientY - dragRef.current.sy;
        if (Math.hypot(tdx, tdy) > DRAG_THRESHOLD) dragRef.current.moved = true;
        const { x, y, scale } = tRef.current;
        const c = clampPan(x + dx, y + dy, scale);
        applyT(c.x, c.y, scale);
      } else if (e.touches.length === 2 && pinchRef.current.on) {
        const t0 = e.touches[0], t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const newScale = clamp(pinchRef.current.s0 * (dist / pinchRef.current.d0), minScaleRef.current, maxScaleRef.current);
        const { x, y, scale } = tRef.current;
        const rect = el.getBoundingClientRect();
        const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const midY = (t0.clientY + t1.clientY) / 2 - rect.top;
        const mx = (midX - x) / scale;
        const my = (midY - y) / scale;
        const c = clampPan(midX - mx * newScale, midY - my * newScale, newScale);
        applyT(c.x, c.y, newScale);
        dragRef.current.moved = true;
      }
    }
    function onWheel(e) {
      e.preventDefault();
      const { x, y, scale } = tRef.current;
      const factor = e.deltaY > 0 ? 0.88 : 1.13;
      const newScale = clamp(scale * factor, minScaleRef.current, maxScaleRef.current);
      const rect = el.getBoundingClientRect();
      const mx = (e.clientX - rect.left - x) / scale;
      const my = (e.clientY - rect.top - y) / scale;
      const c = clampPan(e.clientX - rect.left - mx * newScale, e.clientY - rect.top - my * newScale, newScale);
      applyT(c.x, c.y, newScale);
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("wheel", onWheel);
    };
  }, []); // [] — all handlers use refs only, no stale closures

  // ── React event handlers (passive) ────────────────────────────────────────

  function onTouchStart(e) {
    setSignTooltip(null);
    if (e.touches.length === 1) {
      dragRef.current = { on: true, lx: e.touches[0].clientX, ly: e.touches[0].clientY, sx: e.touches[0].clientX, sy: e.touches[0].clientY, moved: false };
      if (wrapperRef.current) wrapperRef.current.style.willChange = "transform";
    } else if (e.touches.length >= 2) {
      dragRef.current.on = false;
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      pinchRef.current = { on: true, d0: Math.hypot(dx, dy), s0: tRef.current.scale };
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length === 0) {
      dragRef.current.on = false;
      pinchRef.current.on = false;
      // CHANGE 1 Fix-B: clear willChange when gesture fully ends
      if (wrapperRef.current) wrapperRef.current.style.willChange = "auto";
    } else if (e.touches.length === 1) {
      pinchRef.current.on = false;
      dragRef.current = { on: true, lx: e.touches[0].clientX, ly: e.touches[0].clientY, sx: e.touches[0].clientX, sy: e.touches[0].clientY, moved: false };
    }
  }

  function zoomBy(factor) {
    const { x, y, scale } = tRef.current;
    const el = containerRef.current;
    if (!el) return;
    const newScale = clamp(scale * factor, minScaleRef.current, maxScaleRef.current);
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const mx = (cw / 2 - x) / scale;
    const my = (ch / 2 - y) / scale;
    const c = clampPan(cw / 2 - mx * newScale, ch / 2 - my * newScale, newScale);
    applyT(c.x, c.y, newScale);
  }

  function onGroupClick(e, group, hall) {
    e.stopPropagation();
    if (dragRef.current.moved) return;
    const label = boothRangeLabel(group.booths.map((b) => b.no));
    setSelectedBooth({ booth: group.booths[0], hall, mergedLabel: label || null });
  }

  function onBoothClick(e, booth, hall) {
    e.stopPropagation();
    if (dragRef.current.moved) return;
    if (!booth.company) return; // vacant — no sheet
    setSelectedBooth({ booth, hall, mergedLabel: null });
  }

  function onSignClick(e, sign) {
    e.stopPropagation();
    if (dragRef.current.moved) return;
    setSignTooltip((prev) =>
      prev?.sign.id === sign.id ? null : { sign, sx: e.clientX, sy: e.clientY }
    );
  }

  // CHANGE 4-A: map element click handler
  function onElementClick(e, el) {
    e.stopPropagation();
    if (dragRef.current.moved) return;
    setElementTooltip((prev) => prev?.el.id === el.id ? null : { el, sx: e.clientX, sy: e.clientY });
  }

  // ── Booth groups (merged companies share multiple adjacent polygons) ─────────

  const hallGroups = useMemo(() => {
    if (!mapData) return [];
    return (mapData.halls ?? []).map((hall) => ({
      ...hall,
      groups: buildBoothGroups(hall.booths ?? []),
    }));
  }, [mapData]);

  // ── Search results ─────────────────────────────────────────────────────────

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results = [];
    const seen = new Set();
    for (const hall of (mapData?.halls ?? [])) {
      for (const booth of (hall.booths ?? [])) {
        if (!booth.company) continue;
        const co = booth.company;
        if (seen.has(co.id)) continue;
        const fa = (co.brand_name_fa || "").toLowerCase();
        const en = (co.brand_name_en || "").toLowerCase();
        if (!fa.includes(q) && !en.includes(q)) continue;
        seen.add(co.id);
        const pts = booth.bounds ?? [];
        if (!pts.length) continue;
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        results.push({ type: "booth", id: `b-${booth.id}`, name: co.brand_name_fa || co.brand_name_en, nameEn: co.brand_name_en, hall: hall.name, no: booth.no, companyId: co.id, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
        if (results.length >= 12) break;
      }
      if (results.length >= 12) break;
    }
    for (const el of mapElements) {
      const t = ((el.title_fa || "") + " " + (el.title_en || "")).toLowerCase();
      if (!t.includes(q)) continue;
      results.push({ type: "element", id: `e-${el.id}`, name: el.title_fa, nameEn: el.title_en, emoji: getElementEmoji(el), x: el.x, y: el.y });
      if (results.length >= 15) break;
    }
    return results;
  }, [searchQuery, mapData, mapElements]);

  const startSearchResults = useMemo(() => {
    const q = startQuery.trim().toLowerCase();
    if (!q) return [];
    const results = [];
    const seen = new Set();
    for (const hall of (mapData?.halls ?? [])) {
      for (const booth of (hall.booths ?? [])) {
        if (!booth.company) continue;
        const co = booth.company;
        if (seen.has(co.id)) continue;
        const fa = (co.brand_name_fa || "").toLowerCase();
        const en = (co.brand_name_en || "").toLowerCase();
        if (!fa.includes(q) && !en.includes(q)) continue;
        seen.add(co.id);
        const pts = booth.bounds ?? [];
        if (!pts.length) continue;
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        results.push({ type: "booth", id: `b-${booth.id}`, name: co.brand_name_fa || co.brand_name_en, hall: hall.name, no: booth.no, companyId: co.id, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
        if (results.length >= 8) break;
      }
      if (results.length >= 8) break;
    }
    for (const el of mapElements) {
      const t = ((el.title_fa || "") + " " + (el.title_en || "")).toLowerCase();
      if (!t.includes(q)) continue;
      results.push({ type: "element", id: `e-${el.id}`, name: el.title_fa, emoji: getElementEmoji(el), x: el.x, y: el.y });
      if (results.length >= 10) break;
    }
    return results;
  }, [startQuery, mapData, mapElements]);

  // ── Wayfinding helpers ─────────────────────────────────────────────────────

  function panToSvgPoint(svgX, svgY, zoomMult) {
    const el = containerRef.current;
    if (!el) return;
    const fit = fitScaleRef.current;
    const newScale = clamp(fit * (zoomMult ?? 3), minScaleRef.current, maxScaleRef.current);
    const nx = el.clientWidth / 2 - svgX * newScale;
    const ny = el.clientHeight / 2 - svgY * newScale;
    const c = clampPan(nx, ny, newScale);
    applyT(c.x, c.y, newScale);
  }

  function computeRoute(startX, startY, destX, destY) {
    if (!gridRef.current) return null;
    return findGridRoute(gridRef.current, startX, startY, destX, destY);
  }

  function selectDestination(result) {
    setNavDest({ x: result.x, y: result.y, name: result.name || result.nameEn });
    setNavPath(null);
    setNavStart(null);
    setSearchQuery(result.name || result.nameEn || "");
    setSearchOpen(false);
    setStartPanelOpen(true);
    panToSvgPoint(result.x, result.y);
  }

  function confirmStart(startX, startY) {
    setNavStart({ x: startX, y: startY });
    setStartPanelOpen(false);
    setTapStartMode(false);
    setScanActive(false);
    stopQrScan();
    if (navDest) {
      const path = computeRoute(startX, startY, navDest.x, navDest.y);
      setNavPath(path ?? null);
      if (path) {
        const xs = path.map((p) => p.x), ys = path.map((p) => p.y);
        panToSvgPoint((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, 1.6);
      }
    }
  }

  function clearNav() {
    setNavDest(null); setNavStart(null); setNavPath(null);
    setStartPanelOpen(false); setTapStartMode(false);
    setSearchQuery(""); setSearchOpen(false);
    setScanActive(false); stopQrScan();
  }

  // ── QR scanner ─────────────────────────────────────────────────────────────

  function stopQrScan() {
    if (qrControlsRef.current) {
      try { qrControlsRef.current.stop(); } catch (_) {}
      qrControlsRef.current = null;
    }
  }

  const startQrScan = useCallback(async () => {
    setScanActive(true);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: "environment" } },
        qrVideoRef.current,
        (result) => { if (result) handleQrResult(result.getText()); }
      );
      qrControlsRef.current = controls;
    } catch (err) {
      console.error("[QR scan]", err);
      setScanActive(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleQrResult(text) {
    if (!text.startsWith("IPH-BOOTH-")) return;
    stopQrScan();
    setScanActive(false);
    const uuid = text.replace("IPH-BOOTH-", "");
    try {
      const res = await fetch(`/api/map/booth-by-qr?uuid=${encodeURIComponent(uuid)}`);
      const data = await res.json();
      if (!data.company) return;
      const companyId = data.company.id;
      for (const hall of (mapData?.halls ?? [])) {
        for (const booth of (hall.booths ?? [])) {
          if (booth.company?.id !== companyId) continue;
          const pts = booth.bounds ?? [];
          if (!pts.length) continue;
          const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
          confirmStart((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
          return;
        }
      }
    } catch (err) {
      console.error("[QR lookup]", err);
    }
  }

  // Cleanup QR scanner on unmount
  useEffect(() => () => stopQrScan(), []);

  // ── Derived map geometry ───────────────────────────────────────────────────

  const { w: mapW, h: mapH } = dimRef.current;
  const planUrl = mapData ? getPlanUrl(mapData.bare_plan) : null;
  // sign circle / font size relative to map coordinate space
  const signR = mapW / 70;
  const signFs = mapW / 55;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col"
      style={{ height: "100dvh", background: "var(--bg)", overflow: "hidden" }}
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
    >
      {/* ── Page header ── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 pt-4 pb-3"
        style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", zIndex: 20 }}
      >
        <div>
          <h1 className="text-lg font-bold leading-tight" style={{ color: "var(--text)" }}>
            {(isEN ? title_en : title) || (isEN ? "Exhibition Map" : "نقشه نمایشگاه")}
          </h1>
          {(isEN ? subtitle_en : subtitle) && (
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {isEN ? subtitle_en : subtitle}
            </p>
          )}
        </div>

        {mapData && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => zoomBy(1.35)}
              aria-label="Zoom in"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-xl font-bold transition-all active:scale-90"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "inherit", cursor: "pointer" }}
            >+</button>
            <button
              onClick={() => zoomBy(0.74)}
              aria-label="Zoom out"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-xl font-bold transition-all active:scale-90"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "inherit", cursor: "pointer" }}
            >−</button>
            <button
              onClick={() => resetView()}
              aria-label="Reset view"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-base transition-all active:scale-90"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "inherit", cursor: "pointer" }}
              title={isEN ? "Fit to screen" : "نمای کامل"}
            >⊙</button>
          </div>
        )}
      </div>

      {/* ── Map container ── */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        style={{ touchAction: "none", cursor: "grab", userSelect: "none" }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={(e) => {
          if (tapStartMode && !dragRef.current.moved) {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
              const { x: tx, y: ty, scale } = tRef.current;
              const svgX = (e.clientX - rect.left - tx) / scale;
              const svgY = (e.clientY - rect.top - ty) / scale;
              confirmStart(svgX, svgY);
            }
            return;
          }
          setSelectedBooth(null); setSignTooltip(null); setElementTooltip(null); setSearchOpen(false);
        }}
      >
        {/* background glows */}
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(0,255,179,0.03)", zIndex: 0 }} />

        {loading && <MapSkeleton />}

        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center z-10">
            <div style={{ fontSize: 52 }}>🗺️</div>
            <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {isEN ? "Map unavailable" : "نقشه در دسترس نیست"}
            </p>
            <p className="text-xs leading-6" style={{ color: "var(--text-muted)" }}>
              {isEN ? "Could not load exhibition floor plan." : "بارگذاری نقشه نمایشگاه ناموفق بود."}
            </p>
            {error !== "no_data" && (
              <code className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-dim)" }}>
                {error}
              </code>
            )}
          </div>
        )}

        {/* Search bar */}
        {mapData && (
          <MapSearchBar
            query={searchQuery}
            setQuery={setSearchQuery}
            open={searchOpen}
            setOpen={setSearchOpen}
            results={searchResults}
            onSelect={selectDestination}
            destName={navDest && !searchOpen ? navDest.name : null}
            onClearDest={clearNav}
            lang={lang}
            isRTL={isRTL}
          />
        )}

        {/* Tap-to-start overlay hint */}
        {tapStartMode && (
          <div
            className="absolute inset-0 z-[22] flex items-end justify-center pointer-events-none"
            style={{ paddingBottom: 80 }}
          >
            <div
              style={{
                background: "rgba(2,20,21,0.93)", backdropFilter: "blur(12px)",
                border: "1px solid rgba(0,255,179,0.4)", borderRadius: 14,
                padding: "10px 20px", fontSize: 13, color: "var(--accent)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              }}
            >
              {isEN ? "Tap anywhere on the map to set your start point" : "روی نقشه بزنید تا موقعیت شروع تعیین شود"}
            </div>
          </div>
        )}

        {/* CHANGE 4-E: map legend */}
        {mapElements.length > 0 && (
          <MapLegend elements={mapElements} lang={lang} />
        )}

        {mapData && (
          <>
          <div
            ref={wrapperRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: mapW,
              height: mapH,
              transformOrigin: "0 0",
              // CHANGE 1 Fix-A: willChange removed from static style — managed dynamically
            }}
          >
            {/* Floor plan background image */}
            {planUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={planUrl}
                alt="Floor plan"
                draggable={false}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", display: "block" }}
              />
            )}

            {/* SVG overlay: halls + booths + signs */}
            <svg
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
              viewBox={`0 0 ${mapW} ${mapH}`}
              preserveAspectRatio="none"
            >
              {/* Hall name watermarks — large faint text behind all booth polygons */}
              {/* Positioned using booth-bounds union: hall.map_bounds is unreliable —
                  A/B/C/D/E all share identical y-ranges (outer container strip) and
                  x-ranges that don't match where booths actually sit. */}
              {(mapData.halls ?? []).map((hall) => {
                const boothPts = (hall.booths ?? []).flatMap((b) => b.bounds ?? []);
                if (!boothPts.length) return null;
                const bxs = boothPts.map((p) => p.x), bys = boothPts.map((p) => p.y);
                const xMin = Math.min(...bxs), xMax = Math.max(...bxs);
                const yMin = Math.min(...bys), yMax = Math.max(...bys);
                const cx = (xMin + xMax) / 2, cy = (yMin + yMax) / 2;
                const hw = xMax - xMin, hh = yMax - yMin;
                const fs = hh * 0.65;
                return (
                  <text
                    key={`hl-${hall.id}`}
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fs}
                    fontWeight="900"
                    fill={getHallColor(hall, hallColors) || "#ffffff"}
                    fillOpacity={0.18}
                    stroke="none"
                    style={{ userSelect: "none", pointerEvents: "none" }}
                  >
                    {hall.name}
                  </text>
                );
              })}

              {/* Booths */}
              {hallGroups.flatMap((hall) =>
                hall.groups.flatMap((group) => {
                  const isMerged = group.type === "merged";
                  const isVacant = group.type === "vacant";
                  const active = !isVacant && selectedBooth
                    && selectedBooth.booth.company?.id === group.company?.id;
                  const hc = getHallColor(hall, hallColors);
                  return group.booths.map((booth) => {
                    const pts = toPoints(booth.bounds);
                    if (!pts) return null;
                    return (
                      <polygon
                        key={`b-${booth.id}`}
                        points={pts}
                        fill={
                          active
                            ? `${hc}cc`
                            : !isVacant
                            ? `${hc}60`
                            : "rgba(255,255,255,0.04)"
                        }
                        stroke={
                          isMerged && !active
                            ? "none"
                            : active
                            ? hc
                            : !isVacant
                            ? `${hc}99`
                            : "rgba(255,255,255,0.1)"
                        }
                        strokeWidth={active ? (isMerged ? 2 : 3) : 1}
                        style={{ cursor: !isVacant ? "pointer" : "default" }}
                        onClick={(e) =>
                          isMerged
                            ? onGroupClick(e, group, hall)
                            : onBoothClick(e, booth, hall)
                        }
                      />
                    );
                  });
                })
              )}

              {/* Map signs (entrances, facilities, etc.) */}
              {(mapData.map_signs ?? []).map((sign) => {
                if (!sign.coords) return null;
                const isActive = signTooltip?.sign.id === sign.id;
                return (
                  <g
                    key={`s-${sign.id}`}
                    transform={`translate(${sign.coords.x},${sign.coords.y})`}
                    onClick={(e) => onSignClick(e, sign)}
                    style={{ cursor: "pointer" }}
                  >
                    <circle
                      r={signR}
                      fill={isActive ? (sign.color || "#00ffb3") : "rgba(2,31,32,0.88)"}
                      stroke={sign.color || "#00ffb3"}
                      strokeWidth={isActive ? 3 : 2}
                      strokeOpacity={0.75}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={signFs}
                      style={{ userSelect: "none", pointerEvents: "none" }}
                    >
                      {sign.icon || "📍"}
                    </text>
                  </g>
                );
              })}

              {/* Wayfinding route overlay */}
              {navPath && navPath.length >= 2 && (() => {
                const strokeW = mapW / 180;
                const markerR = signR * 1.5;
                const start = navPath[0];
                const dest = navPath[navPath.length - 1];
                return (
                  <g style={{ pointerEvents: "none" }}>
                    {/* Dashed route line */}
                    <polyline
                      points={navPath.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke="#00ffb3"
                      strokeWidth={strokeW}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={`${mapW / 70} ${mapW / 220}`}
                      strokeOpacity={0.9}
                    />
                    {/* Start pin (blue) */}
                    <circle cx={start.x} cy={start.y} r={markerR} fill="#3b82f6" stroke="#fff" strokeWidth={strokeW * 0.6} />
                    <text x={start.x} y={start.y} textAnchor="middle" dominantBaseline="central" fontSize={signFs * 0.85} style={{ userSelect: "none" }}>🔵</text>
                    {/* Destination pin (orange) */}
                    <circle cx={dest.x} cy={dest.y} r={markerR * 1.2} fill="#f97316" stroke="#fff" strokeWidth={strokeW * 0.6} />
                    <text x={dest.x} y={dest.y} textAnchor="middle" dominantBaseline="central" fontSize={signFs} style={{ userSelect: "none" }}>🏁</text>
                  </g>
                );
              })()}

              {/* CHANGE 4-B: Local map elements (admin-managed) */}
              {mapElements.map((el) => {
                const isActive = elementTooltip?.el.id === el.id;
                const emoji = getElementEmoji(el);
                return (
                  <g
                    key={`me-${el.id}`}
                    transform={`translate(${el.x},${el.y})`}
                    onClick={(e) => onElementClick(e, el)}
                    style={{ cursor: "pointer" }}
                  >
                    <circle
                      r={signR * 1.1}
                      fill={isActive ? (el.color || "#3b82f6") : "rgba(2,31,32,0.88)"}
                      stroke={el.color || "#3b82f6"}
                      strokeWidth={isActive ? 3 : 2}
                      strokeOpacity={0.85}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={signFs}
                      style={{ userSelect: "none", pointerEvents: "none" }}
                    >
                      {emoji}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Booth number labels (inside wrapper — scales with map; font-size compensates via CSS var) */}
            <div
              ref={boothLabelsWrapRef}
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                opacity: 0,
                transition: "opacity 0.15s",
              }}
            >
              {hallGroups.flatMap((hall) =>
                hall.groups.map((group, gi) => {
                  const allPts = group.booths.flatMap((b) =>
                    Array.isArray(b.bounds) ? b.bounds : []
                  );
                  const c = polyCenter(allPts);
                  if (!c) return null;
                  const label = boothRangeLabel(group.booths.map((b) => b.no));
                  if (!label) return null;
                  const key = group.company
                    ? `gl-${hall.id}-${group.company.id}`
                    : `vl-${group.booths[0].id}`;
                  return (
                    <span
                      key={key}
                      style={{
                        position: "absolute",
                        left: c.cx,
                        top: c.cy,
                        transform: "translate(-50%,-50%)",
                        fontSize: "calc(10px / var(--map-s, 1))",
                        lineHeight: 1,
                        fontWeight: 700,
                        fontFamily: "inherit",
                        color: group.company
                          ? "rgba(255,255,255,0.92)"
                          : "rgba(255,255,255,0.38)",
                        whiteSpace: "nowrap",
                        userSelect: "none",
                        pointerEvents: "none",
                      }}
                    >
                      {label}
                    </span>
                  );
                })
              )}
            </div>
          </div>

          {/* Route info card — floats above bottom nav */}
          {navPath && (
            <RouteInfoCard path={navPath} lang={lang} isRTL={isRTL} onClear={clearNav} />
          )}
          </>
        )}
      </div>

      {/* ── Sign tooltip (above BottomNav) ── */}
      {signTooltip && (
        <SignTooltip sign={signTooltip.sign} sx={signTooltip.sx} sy={signTooltip.sy} lang={lang} />
      )}

      {/* CHANGE 4-D: Map element tooltip */}
      {elementTooltip && (
        <MapElementTooltip el={elementTooltip.el} sx={elementTooltip.sx} sy={elementTooltip.sy} lang={lang} />
      )}

      {/* ── Booth sheet + backdrop ── */}
      {selectedBooth && (
        <>
          <div
            className="fixed inset-0 z-[53]"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onClick={() => setSelectedBooth(null)}
          />
          <BoothSheet
            booth={selectedBooth.booth}
            hall={selectedBooth.hall}
            mergedLabel={selectedBooth.mergedLabel}
            lang={lang}
            isRTL={isRTL}
            onClose={() => setSelectedBooth(null)}
          />
        </>
      )}

      {/* ── Start point panel ── */}
      {startPanelOpen && !tapStartMode && (
        <StartPanel
          lang={lang}
          isRTL={isRTL}
          onTapMode={() => { setTapStartMode(true); setStartPanelOpen(false); setScanActive(false); stopQrScan(); }}
          onScanMode={() => { if (!scanActive) startQrScan(); else { setScanActive(false); stopQrScan(); } }}
          startQuery={startQuery}
          setStartQuery={setStartQuery}
          startResults={startSearchResults}
          onSelectStart={(r) => confirmStart(r.x, r.y)}
          onCancel={clearNav}
          scanActive={scanActive}
          videoRef={qrVideoRef}
        />
      )}

      <BottomNav />
    </div>
  );
}
