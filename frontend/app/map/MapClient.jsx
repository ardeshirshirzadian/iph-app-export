"use client";

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  ⚠️  CRITICAL PERFORMANCE RULES — READ BEFORE ADDING ANY NEW MAP FEATURE  ║
// ║                                                                              ║
// ║  This file has caused THREE separate iOS Safari GPU-memory crash regressions ║
// ║  (map elements, route arrows, walls). Every new feature must obey:           ║
// ║                                                                              ║
// ║  RULE 1 — NO React setState during active gesture frames.                    ║
// ║    • All transform updates go through applyT() → wrapperRef direct DOM.      ║
// ║    • ✅ correct: applyT(x, y, scale)                                         ║
// ║    • ❌ wrong:  setScale(newScale)  inside onPointerMove / onTouchMove       ║
// ║                                                                              ║
// ║  RULE 2 — willChange:"transform" must ONLY be active during gestures.        ║
// ║    • Set it at gesture START; rely solely on onGestureSettle() to clear it.  ║
// ║    • NEVER call wrapperRef.current.style.willChange = "auto" inside          ║
// ║      cancelMomentum() or cancelZoomAnim() — those functions only cancel the  ║
// ║      RAF; the 120 ms settle timer is the single owner of the "auto" reset.   ║
// ║    • ✅ correct: wrapperRef.current.style.willChange = "transform" in        ║
// ║                  onPointerDown / onTouchStart / startMomentum / smoothZoom   ║
// ║    • ❌ wrong:  permanently setting willChange in JSX style={{ willChange }}  ║
// ║    • ❌ wrong:  toggling "auto" inside cancel helpers (causes rapid           ║
// ║                  alloc/dealloc of GPU layers → iOS Safari crash on 10+ zooms)║
// ║                                                                              ║
// ║  RULE 3 — No per-frame expensive derived-data recomputation.                 ║
// ║    • Grid builds, centroid calcs, line-intersection tests: compute ONCE when ║
// ║      underlying data changes; cache in a ref.                                ║
// ║    • ✅ correct: floorGridsRef.current built lazily in confirmStart, cached   ║
// ║    • ❌ wrong:  calling buildFloorGrids() or _segmentsIntersect() inside     ║
// ║                  applyT(), onTouchMove(), or any RAF step callback           ║
// ║                                                                              ║
// ║  ADDING A NEW FEATURE CHECKLIST:                                             ║
// ║    [ ] Does it add SVG/DOM nodes inside wrapperRef? → hide them during       ║
// ║        gesture via onGestureStart / onGestureSettle (see routeLayerRef).     ║
// ║    [ ] Does it compute something on data? → useMemo with stable deps.        ║
// ║    [ ] Does it need pathfinding? → add to buildFloorGrids once, cache it.    ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import { useLang } from "@/lib/useLang";
import { toPersianDigits } from "@/lib/utils";
import { buildFloorGrids, findMultiFloorRoute, pathLength } from "@/lib/mapPathfinding";
import Map3DView from "./Map3DView";

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

// Compute the geometric center of a map_zone for any shape type.
function zoneCenter(zone) {
  const shape = zone.shape_type || 'rectangle';
  if (shape === 'circle' && zone.cx != null) return { x: zone.cx, y: zone.cy };
  if (shape === 'polygon' && Array.isArray(zone.points) && zone.points.length >= 3) {
    // True polygon centroid (Shoelace formula)
    const pts = zone.points;
    let ax = 0, ay = 0, area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      area += cross; ax += (pts[i].x + pts[j].x) * cross; ay += (pts[i].y + pts[j].y) * cross;
    }
    area /= 2;
    if (Math.abs(area) < 0.001) {
      const sx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const sy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      return { x: sx, y: sy };
    }
    return { x: ax / (6 * area), y: ay / (6 * area) };
  }
  // rectangle fallback
  return { x: ((zone.x1 ?? 0) + (zone.x2 ?? 0)) / 2, y: ((zone.y1 ?? 0) + (zone.y2 ?? 0)) / 2 };
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

// Module-level constants/helpers (no hooks — safe outside component)
const PRESET_ICONS = {
  exit: "🚪", entrance: "🚶", wc: "🚻", cafe: "☕",
  restaurant: "🍽️", prayer: "🕌", mic: "🎤", info: "ℹ️",
  medical: "🏥", parking: "🅿️", stairs: "🪜",
};

// Returns the floor number for a given SVG coordinate by checking which hall
// bbox the point falls inside. Defaults to 0 if outside all halls.
function getFloorAtPoint(x, y, halls) {
  for (const hall of halls) {
    const pts = (hall.booths ?? []).flatMap(b => b.bounds ?? []);
    if (!pts.length) continue;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    if (x >= Math.min(...xs) && x <= Math.max(...xs) &&
        y >= Math.min(...ys) && y <= Math.max(...ys)) {
      return hall.floor ?? 0;
    }
  }
  return 0;
}
function getElementEmoji(el) {
  if (el.icon_type === "preset") return PRESET_ICONS[el.icon_value] || "📍";
  if (el.icon_type === "upload") return null; // rendered as <image>, not text
  return el.icon_value || "📍";
}
function getHallColor(hall, hallColors) {
  return hallColors[hall.name] || hall.color || "#00ffb3";
}


// Samples a [{x,y}] polyline at regular arc-length intervals and returns
// [{x, y, angle}] where angle (degrees) is the tangent direction at each point.
// The first arrow is placed at interval/2 from the start so arrows are centred
// within the route rather than piling up at the very beginning.
function routeArrows(pts, interval) {
  const out = [];
  if (pts.length < 2 || interval <= 0) return out;
  let dist = interval / 2; // countdown to next arrow
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy);
    if (len < 0.1) continue;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    while (dist <= len) {
      out.push({
        x: pts[i - 1].x + dx * dist / len,
        y: pts[i - 1].y + dy * dist / len,
        angle: ang,
      });
      dist += interval;
    }
    dist -= len; // carry remainder into next segment
  }
  return out;
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
                {r.type === "element" ? r.emoji : r.type === "zone" ? "🔲" : "🏪"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {isEN ? (r.nameEn || r.name) : r.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {r.type === "booth"
                    ? `${isEN ? "Hall" : "سالن"} ${r.hall} · ${isEN ? "Booth" : "غرفه"} ${r.no}`
                    : r.type === "zone"
                    ? (isEN ? "Area / Zone" : "منطقه / سالن")
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
            <span style={{ fontSize: 18 }}>{r.type === "element" ? r.emoji : r.type === "zone" ? "🔲" : "🏪"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{isEN ? (r.nameEn || r.name) : r.name}</div>
              {r.type === "booth" && (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{isEN ? "Hall" : "سالن"} {r.hall}</div>
              )}
              {r.type === "zone" && (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{isEN ? "Area / Zone" : "منطقه / سالن"}</div>
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

function RouteInfoCard({ route, lang, isRTL, onClear }) {
  if (!route) return null;
  const isEN = lang === "en";

  // Card shell: flex-column so the clear button always occupies its own row below
  // the info content, never overlapping it regardless of text length or UI language.
  const cardStyle = {
    bottom: "calc(68px + env(safe-area-inset-bottom))", left: 8, right: 8,
    background: "rgba(2,20,21,0.96)", backdropFilter: "blur(16px)",
    borderRadius: 16,
    padding: "12px 16px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
    display: "flex", flexDirection: "column", gap: 10,
  };
  // Info row inside the card: icon + text, respects RTL text direction
  const infoRow = { display: "flex", alignItems: "center", gap: 12, direction: isRTL ? "rtl" : "ltr" };
  // Button row: always LTR so "حذف مسیر" sits on the RIGHT end, away from MapLegend
  // which is anchored to the left (bottom-left corner).
  const btnRow = { display: "flex", justifyContent: "flex-end", direction: "ltr" };
  const clearBtn = (
    <button
      onClick={onClear}
      style={{
        background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8, padding: "6px 14px", color: "var(--text-muted)",
        fontFamily: "inherit", fontSize: 12, cursor: "pointer", flexShrink: 0,
      }}
    >
      {isEN ? "Clear route" : "حذف مسیر"}
    </button>
  );

  if (route.type === "computing") {
    return (
      <div className="absolute z-[20]" style={{ ...cardStyle, border: "1px solid rgba(0,255,179,0.15)" }}>
        <div style={infoRow}>
          <span style={{ fontSize: 20 }}>🧭</span>
          <div className="animate-pulse" style={{ flex: 1, fontSize: 14, color: "var(--accent)" }}>
            {isEN ? "Calculating route…" : "در حال محاسبه مسیر…"}
          </div>
        </div>
      </div>
    );
  }

  if (route.type === "no_connection") {
    return (
      <div className="absolute z-[20]" style={{ ...cardStyle, border: "1px solid rgba(249,115,22,0.4)" }}>
        <div style={infoRow}>
          <span style={{ fontSize: 22 }}>🚫</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f97316" }}>
              {isEN ? "No floor connection found" : "مسیر بین طبقات یافت نشد"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {isEN ? "Ensure staircase elements are configured on the map" : "مطمئن شوید عناصر پله در نقشه تنظیم شده‌اند"}
            </div>
          </div>
        </div>
        <div style={btnRow}>{clearBtn}</div>
      </div>
    );
  }

  const isMultiFloor = route.type === "multi_floor";
  const totalDist = isMultiFloor
    ? pathLength(route.pathA) + pathLength(route.pathB)
    : pathLength(route.path ?? []);
  // ~15 SVG units ≈ 1 m (approximate based on typical exhibition booth dimensions)
  const meters = Math.max(1, Math.round(totalDist / 15));
  const minutes = Math.max(1, Math.round(meters / 72)); // 1.2 m/s walking

  return (
    <div className="absolute z-[20]" style={{ ...cardStyle, border: "1px solid rgba(0,255,179,0.3)" }}>
      <div style={infoRow}>
        <span style={{ fontSize: 22 }}>{isMultiFloor ? "🪜" : "🧭"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>
            {isEN ? `≈ ${meters} m · ${minutes} min` : `≈ ${meters} متر · ${toPersianDigits(minutes)} دقیقه`}
          </div>
          {isMultiFloor && (
            <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 1 }}>
              {isEN ? "Route includes floor change via staircase" : "مسیر شامل تغییر طبقه از پله است"}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {isEN ? "Estimated walking time" : "زمان تقریبی پیاده‌روی"}
          </div>
        </div>
      </div>
      <div style={btnRow}>{clearBtn}</div>
    </div>
  );
}

// ── Booth Bottom Sheet ─────────────────────────────────────────────────────────

function BoothSheet({ booth, hall, mergedLabel, lang, isRTL, onClose }) {
  const isEN = lang === "en";
  const co = booth.company;
  const [imgErr, setImgErr] = useState(false);
  const logoUrl = imgErr ? null : getLogoUrl(co?.logo);
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
              <img src={logoUrl} alt="" onError={() => setImgErr(true)} style={{ width: "80%", height: "80%", objectFit: "contain" }} />
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

// ── Zone Sheet ────────────────────────────────────────────────────────────────

function ZoneSheet({ zone, lang, isRTL, onClose, onNavigate }) {
  const isEN = lang === "en";
  const title = isEN ? (zone.title_en || zone.title_fa) : zone.title_fa;
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[55] rounded-t-3xl"
      style={{
        background: "rgba(2,20,21,0.97)",
        backdropFilter: "blur(28px)",
        borderTop: "1px solid rgba(0,255,179,0.25)",
        paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom))",
      }}
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
      </div>
      <div className="px-5 pb-2">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,255,179,0.08)", border: "1px solid rgba(0,255,179,0.2)" }}
          >
            <span style={{ fontSize: 24 }}>🏛️</span>
          </div>
          <div>
            <p className="font-bold text-base leading-snug" style={{ color: "var(--text)" }}>
              {title}
            </p>
            {zone.hall_name && (
              <p className="text-xs mt-0.5" style={{ color: "var(--accent)" }}>
                📍 {isEN ? `Hall ${zone.hall_name}` : `سالن ${zone.hall_name}`}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { onNavigate(); onClose(); }}
            className="flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
            style={{ background: "var(--accent)", color: "#021f20", fontFamily: "inherit", cursor: "pointer", border: "none" }}
          >
            {isEN ? "Set as destination" : "تنظیم به عنوان مقصد"}
          </button>
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
      className="absolute z-[30] rounded-xl overflow-hidden"
      style={{
        bottom: "calc(68px + env(safe-area-inset-bottom))", left: 12,
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

export default function MapClient({ title, subtitle, title_en, subtitle_en, isHomeContext = false }) {
  const { lang, isRTL } = useLang();
  const isEN = lang === "en";

  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // null | string
  const [selectedBooth, setSelectedBooth] = useState(null); // { booth, hall }
  const [selectedZone, setSelectedZone] = useState(null);   // zone object | null
  const [signTooltip, setSignTooltip] = useState(null); // { sign, sx, sy }
  // CHANGE 3-A: new state for hall colors, map elements, element tooltip
  const [hallColors, setHallColors] = useState({});
  const [hallFloors, setHallFloors] = useState({});
  const [mapElements, setMapElements] = useState([]);
  const [mapZones, setMapZones] = useState([]);
  const [mapWalls, setMapWalls] = useState([]);
  const [mapDoors, setMapDoors] = useState([]);
  const [elementTooltip, setElementTooltip] = useState(null); // { el, sx, sy }
  const [view3D, setView3D] = useState(false);

  // Navigation state
  const [navDest, setNavDest] = useState(null);       // { x, y, name, floor }
  const [navStart, setNavStart] = useState(null);     // { x, y }
  const [navRoute, setNavRoute] = useState(null);     // result from findMultiFloorRoute
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
  const floorGridsRef = useRef(null); // per-floor walkable grids, built once per map load

  // drag / pinch — vx/vy/lt track velocity for momentum
  const dragRef = useRef({ on: false, lx: 0, ly: 0, sx: 0, sy: 0, moved: false, vx: 0, vy: 0, lt: 0 });
  const pinchRef = useRef({ on: false, d0: 0, s0: 1 });

  // animation state (rAF ids only — never React state)
  const momentumRef = useRef({ rafId: 0 });
  const zoomAnimRef = useRef({ rafId: 0 });
  // double-tap detection
  const lastTapRef = useRef({ time: 0, x: 0, y: 0 });
  const doubleTapJustFiredRef = useRef(false);

  // label rendering refs
  const fitScaleRef = useRef(1);
  const boothLabelsWrapRef = useRef(null);

  // gesture-simplify: active flag (prevents applyT from overriding hidden state),
  // debounce timer for restoration, and route layer ref
  const gestureActiveRef = useRef(false);
  const gestureSettleTimerRef = useRef(null);
  const routeLayerRef = useRef(null);
  // mirrors view3D state so closures/timeouts always read the current mode
  const view3DRef    = useRef(false);
  // imperative handle to the Map3DView component (focusOnPoint, resetView, zoom)
  const map3DViewRef = useRef(null);

  // ════════════════════════════════════════════════════════════════════════════
  // PAN / ZOOM CORE — DO NOT ADD STATE UPDATES OR EXPENSIVE LOGIC INSIDE HERE
  // Everything below until "Data fetch" uses only refs + direct DOM writes.
  // Any new map feature code (rendering, data, route logic) belongs OUTSIDE this
  // section. See the CRITICAL PERFORMANCE RULES block at the top of this file.
  // ════════════════════════════════════════════════════════════════════════════

  // ── Transform helpers ──────────────────────────────────────────────────────

  function applyT(x, y, scale) {
    tRef.current = { x, y, scale };
    if (wrapperRef.current) {
      wrapperRef.current.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    }
    // Booth numbers: update CSS var (font-size cancels scale) + visibility threshold.
    // Skip opacity write during active gestures — onGestureStart already hid them
    // and applyT would otherwise override that on every frame.
    if (boothLabelsWrapRef.current) {
      boothLabelsWrapRef.current.style.setProperty("--map-s", scale);
      if (!gestureActiveRef.current) {
        const show = fitScaleRef.current > 0 && scale > fitScaleRef.current * 1.8;
        boothLabelsWrapRef.current.style.opacity = show ? "1" : "0";
      }
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

  // Cancel momentum animation (safe to call any time).
  // Does NOT touch willChange — onGestureSettle() is the sole owner of the
  // "auto" reset. Callers that cancel momentum always either immediately start
  // a new gesture (which keeps willChange = "transform") or have already called
  // onGestureSettle / will let onTouchEnd reset willChange via onGestureSettle.
  function cancelMomentum() {
    if (momentumRef.current.rafId) {
      cancelAnimationFrame(momentumRef.current.rafId);
      momentumRef.current.rafId = 0;
    }
  }

  // Cancel smooth-zoom animation. Does NOT touch willChange for the same reason
  // as cancelMomentum — the settle timer owns the "auto" transition.
  function cancelZoomAnim() {
    if (zoomAnimRef.current.rafId) {
      cancelAnimationFrame(zoomAnimRef.current.rafId);
      zoomAnimRef.current.rafId = 0;
    }
  }

  // Hide detail SVG layers during active gestures/animations to reduce the
  // number of nodes the GPU composites. Both layers have lots of elements
  // (booth labels + route arrows/markers) that are invisible during a fast
  // pan or pinch anyway. Restored 120 ms after the gesture fully settles.
  function onGestureStart() {
    if (gestureSettleTimerRef.current) {
      clearTimeout(gestureSettleTimerRef.current);
      gestureSettleTimerRef.current = null;
    }
    gestureActiveRef.current = true;
    if (boothLabelsWrapRef.current) boothLabelsWrapRef.current.style.opacity = "0";
    if (routeLayerRef.current) routeLayerRef.current.style.visibility = "hidden";
  }
  function onGestureSettle() {
    if (gestureSettleTimerRef.current) clearTimeout(gestureSettleTimerRef.current);
    gestureSettleTimerRef.current = setTimeout(() => {
      gestureActiveRef.current = false;
      gestureSettleTimerRef.current = null;
      // Sole owner of willChange reset — never clear it inside cancel helpers,
      // because rapid cancel→restart cycles (zoom button clicks, double-taps)
      // would cause GPU layer alloc/dealloc thrashing and iOS Safari crashes.
      if (wrapperRef.current) wrapperRef.current.style.willChange = "auto";
      if (routeLayerRef.current) routeLayerRef.current.style.visibility = "";
      if (boothLabelsWrapRef.current) {
        const { scale } = tRef.current;
        const show = fitScaleRef.current > 0 && scale > fitScaleRef.current * 1.8;
        boothLabelsWrapRef.current.style.opacity = show ? "1" : "0";
      }
    }, 120);
  }

  // Start momentum after drag release.  vx/vy are in px/ms.
  // Uses frame-rate-independent exponential friction: 0.94 per 16 ms frame.
  function startMomentum(vx0, vy0) {
    cancelMomentum();
    const FRICTION = 0.94; // per nominal 16 ms frame
    const STOP = 0.012;    // px/ms — below this, stop
    let vx = vx0, vy = vy0;
    let prev = performance.now();
    if (wrapperRef.current) wrapperRef.current.style.willChange = "transform";

    function step(now) {
      const dt = Math.min(now - prev, 64); // cap frame gap at 64 ms
      prev = now;
      const fric = Math.pow(FRICTION, dt / 16);
      vx *= fric;
      vy *= fric;
      if (Math.hypot(vx, vy) < STOP) {
        momentumRef.current.rafId = 0;
        onGestureSettle(); // settle timer owns the willChange → "auto" transition
        return;
      }
      const { x, y, scale } = tRef.current;
      const nx = x + vx * dt;
      const ny = y + vy * dt;
      const c = clampPan(nx, ny, scale);
      // Stop momentum axis if we hit the boundary
      if (Math.abs(c.x - nx) > 0.5) vx = 0;
      if (Math.abs(c.y - ny) > 0.5) vy = 0;
      applyT(c.x, c.y, scale);
      momentumRef.current.rafId = requestAnimationFrame(step);
    }
    momentumRef.current.rafId = requestAnimationFrame(step);
  }

  // Smoothly zoom toward a viewport point (vpX, vpY) to targetScale.
  // The SVG point under (vpX, vpY) stays visually fixed throughout the animation.
  // Uses cubic ease-out over ~220 ms.
  function smoothZoomToward(vpX, vpY, targetScale, duration = 220) {
    cancelZoomAnim(); // cancels any prior RAF (does NOT touch willChange)
    onGestureStart();
    const { x: x0, y: y0, scale: s0 } = tRef.current;
    const s1 = clamp(targetScale, minScaleRef.current, maxScaleRef.current);
    // Compute the SVG point under the focal viewport coord
    const svgFx = (vpX - x0) / s0;
    const svgFy = (vpY - y0) / s0;
    // End position: focal SVG point maps back to the same viewport coord
    const { x: x1, y: y1 } = clampPan(vpX - svgFx * s1, vpY - svgFy * s1, s1);
    const t0 = performance.now();
    if (wrapperRef.current) wrapperRef.current.style.willChange = "transform";

    function step(now) {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - (1 - p) ** 3; // cubic ease-out
      // Using same easing for both position and scale keeps the focal point fixed
      applyT(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, s0 + (s1 - s0) * e);
      if (p < 1) {
        zoomAnimRef.current.rafId = requestAnimationFrame(step);
      } else {
        zoomAnimRef.current.rafId = 0;
        onGestureSettle(); // settle timer owns willChange → "auto"; do not reset it here
      }
    }
    zoomAnimRef.current.rafId = requestAnimationFrame(step);
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
        if (d.hallFloors) setHallFloors(d.hallFloors);
        if (d.mapElements) setMapElements(d.mapElements);
        if (d.mapZones) setMapZones(d.mapZones);
        if (d.mapWalls) setMapWalls(d.mapWalls);
        if (d.mapDoors) setMapDoors(d.mapDoors);
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

  // Grid is built lazily on first route request (see confirmStart).
  // Building it eagerly here blocked the main thread for 2-3 s before the
  // map SVG could paint — moved to lazy to eliminate that delay.

  // Invalidate the cached grid whenever any of its inputs change (e.g. walls or
  // zones updated by admin while the map page is open).  Next route request
  // rebuilds it.  mapWalls / mapZones / hallFloors are loaded once on mount in
  // normal usage, but a future polling mechanism would need this guard.
  useEffect(() => {
    floorGridsRef.current = null;
  }, [mapWalls, mapZones, mapDoors, hallFloors]);

  // Keep view3DRef in sync so closures/timeouts always read the current mode.
  useEffect(() => { view3DRef.current = view3D; }, [view3D]);

  // CHANGE 1: Consolidated non-passive event listeners (pointer + touchmove + wheel)
  // [] dependency — all handlers read only refs, no stale closures

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Shared velocity EMA helper (alpha=0.6: responsive but not jittery)
    function trackVelocity(dx, dy, dt) {
      if (dt > 100) {
        // User paused before releasing — kill accumulated velocity
        dragRef.current.vx = 0;
        dragRef.current.vy = 0;
      } else if (dt > 0) {
        const ALPHA = 0.6;
        dragRef.current.vx = ALPHA * (dx / dt) + (1 - ALPHA) * dragRef.current.vx;
        dragRef.current.vy = ALPHA * (dy / dt) + (1 - ALPHA) * dragRef.current.vy;
      }
      dragRef.current.lt = performance.now();
    }

    function onPointerDown(e) {
      if (e.pointerType === "touch") return;
      if (view3DRef.current) return; // 3D: OrbitControls handles it
      cancelMomentum();
      cancelZoomAnim();
      onGestureStart();
      dragRef.current = { on: true, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, vx: 0, vy: 0, lt: performance.now() };
      el.setPointerCapture(e.pointerId);
      setSignTooltip(null);
      if (wrapperRef.current) wrapperRef.current.style.willChange = "transform";
    }
    function onPointerMove(e) {
      if (e.pointerType === "touch" || !dragRef.current.on) return;
      if (view3DRef.current) return;
      const now = performance.now();
      const dx = e.clientX - dragRef.current.lx;
      const dy = e.clientY - dragRef.current.ly;
      trackVelocity(dx, dy, now - dragRef.current.lt);
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
      const { vx, vy, moved } = dragRef.current;
      dragRef.current.on = false;
      // Do not reset willChange here — startMomentum keeps it if launching momentum;
      // onGestureSettle timer clears it after 120 ms of quiet in all cases.
      if (moved && Math.hypot(vx, vy) > 0.04) {
        startMomentum(vx, vy);
      } else {
        onGestureSettle();
      }
    }
    function onTouchMove(e) {
      if (view3DRef.current) return; // 3D: OrbitControls handles touch; skip e.preventDefault() too
      e.preventDefault();
      if (e.touches.length === 1 && dragRef.current.on) {
        const now = performance.now();
        const dx = e.touches[0].clientX - dragRef.current.lx;
        const dy = e.touches[0].clientY - dragRef.current.ly;
        trackVelocity(dx, dy, now - dragRef.current.lt);
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
      if (view3DRef.current) return;
      cancelMomentum();
      cancelZoomAnim(); // interrupt any smooth-zoom RAF that's already animating
      // Wheel has no explicit "end" event, so we call onGestureStart on every
      // event (it clears any pending settle timer) and onGestureSettle at the
      // end (which starts a fresh 120 ms timer).  The net result: willChange
      // stays "transform" for the duration of the wheel burst and reverts 120 ms
      // after the last wheel event — identical to drag / pinch lifecycle.
      onGestureStart();
      if (wrapperRef.current) wrapperRef.current.style.willChange = "transform";
      const { x, y, scale } = tRef.current;
      const factor = e.deltaY > 0 ? 0.88 : 1.13;
      const newScale = clamp(scale * factor, minScaleRef.current, maxScaleRef.current);
      const rect = el.getBoundingClientRect();
      const mx = (e.clientX - rect.left - x) / scale;
      const my = (e.clientY - rect.top - y) / scale;
      const c = clampPan(e.clientX - rect.left - mx * newScale, e.clientY - rect.top - my * newScale, newScale);
      applyT(c.x, c.y, newScale);
      onGestureSettle();
    }
    function onDblClick(e) {
      const rect = el.getBoundingClientRect();
      smoothZoomToward(e.clientX - rect.left, e.clientY - rect.top, tRef.current.scale * 1.8);
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDblClick);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDblClick);
      cancelMomentum();
      cancelZoomAnim();
      if (gestureSettleTimerRef.current) clearTimeout(gestureSettleTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // [] — all handlers use refs only, no stale closures

  // ── React event handlers (passive) ────────────────────────────────────────

  function onTouchStart(e) {
    if (view3DRef.current) return; // 3D: OrbitControls handles touch
    cancelMomentum(); // new touch always cancels in-flight momentum
    cancelZoomAnim();
    onGestureStart();
    setSignTooltip(null);
    if (e.touches.length === 1) {
      dragRef.current = { on: true, lx: e.touches[0].clientX, ly: e.touches[0].clientY, sx: e.touches[0].clientX, sy: e.touches[0].clientY, moved: false, vx: 0, vy: 0, lt: performance.now() };
      if (wrapperRef.current) wrapperRef.current.style.willChange = "transform";
    } else if (e.touches.length >= 2) {
      dragRef.current.on = false;
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      pinchRef.current = { on: true, d0: Math.hypot(dx, dy), s0: tRef.current.scale };
      if (wrapperRef.current) wrapperRef.current.style.willChange = "transform";
    }
  }

  function onTouchEnd(e) {
    if (view3DRef.current) return; // 3D: OrbitControls handles touch
    if (e.touches.length === 0) {
      const wasDrag = dragRef.current.on;
      const { moved, vx, vy } = dragRef.current;
      dragRef.current.on = false;
      pinchRef.current.on = false;
      // Do not reset willChange here: startMomentum keeps it active if launching
      // momentum; smoothZoomToward keeps it for double-tap zoom; onGestureSettle
      // clears it after 120 ms of quiet. Direct reset here would cause a brief
      // "auto" blip that thrashes the GPU layer on fast double-taps.

      // Momentum: fire if the user was actively dragging (not tapping or pinching)
      if (wasDrag && moved && Math.hypot(vx, vy) > 0.04) {
        startMomentum(vx, vy);
      } else {
        onGestureSettle();
      }

      // Double-tap detection (only for stationary taps, not drags)
      if (wasDrag && !moved && e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        const now = Date.now();
        const last = lastTapRef.current;
        const dist = Math.hypot(touch.clientX - last.x, touch.clientY - last.y);
        if (now - last.time < 300 && dist < 40) {
          // Double-tap!
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            doubleTapJustFiredRef.current = true; // suppress the upcoming onClick
            smoothZoomToward(touch.clientX - rect.left, touch.clientY - rect.top, tRef.current.scale * 1.8);
          }
          lastTapRef.current = { time: 0, x: 0, y: 0 }; // prevent triple-tap from triggering
        } else {
          lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
        }
      }
    } else if (e.touches.length === 1) {
      pinchRef.current.on = false;
      dragRef.current = { on: true, lx: e.touches[0].clientX, ly: e.touches[0].clientY, sx: e.touches[0].clientX, sy: e.touches[0].clientY, moved: false, vx: 0, vy: 0, lt: performance.now() };
    }
  }

  function zoomBy(factor) {
    cancelMomentum();
    const el = containerRef.current;
    if (!el) return;
    const targetScale = clamp(tRef.current.scale * factor, minScaleRef.current, maxScaleRef.current);
    smoothZoomToward(el.clientWidth / 2, el.clientHeight / 2, targetScale);
  }

  function onGroupClick(e, group, hall) {
    e.stopPropagation();
    if (dragRef.current.moved) return;
    const label = boothRangeLabel(group.booths.map((b) => b.no));
    setSelectedZone(null);
    setSelectedBooth({ booth: group.booths[0], hall, mergedLabel: label || null });
  }

  function onBoothClick(e, booth, hall) {
    e.stopPropagation();
    if (dragRef.current.moved) return;
    if (!booth.company) return; // vacant — no sheet
    setSelectedZone(null);
    setSelectedBooth({ booth, hall, mergedLabel: null });
  }

  function onZoneClick(e, zone) {
    e.stopPropagation();
    if (dragRef.current.moved) return;
    setSelectedBooth(null);
    setSelectedZone(zone);
  }

  function onZone3DTap(zone, meta) {
    if (tapStartMode) { confirmStart(meta.cx, meta.cy); return; }
    setSelectedBooth(null);
    setSelectedZone(zone);
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

  // 3D mode booth tap — drag detection is handled inside Map3DView before this fires.
  function onBooth3DTap(booth, hall, meta) {
    // meta = { cx: mapX, cy: mapY, mergedLabel }
    if (tapStartMode) { confirmStart(meta.cx, meta.cy); return; }
    if (!booth.company) return;
    setSelectedZone(null);
    setSelectedBooth({ booth, hall, mergedLabel: meta.mergedLabel || null });
  }

  // ── Booth groups (merged companies share multiple adjacent polygons) ─────────

  const hallGroups = useMemo(() => {
    if (!mapData) return [];
    return (mapData.halls ?? []).map((hall) => ({
      ...hall,
      floor: hallFloors[hall.name] ?? 0,
      groups: buildBoothGroups(hall.booths ?? []),
    }));
  }, [mapData, hallFloors]);

  const stairsElements = useMemo(
    () => mapElements.filter(el => el.icon_type === "preset" && el.icon_value === "stairs"),
    [mapElements]
  );

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
        results.push({ type: "booth", id: `b-${booth.id}`, name: co.brand_name_fa || co.brand_name_en, nameEn: co.brand_name_en, hall: hall.name, no: booth.no, companyId: co.id, floor: hallFloors[hall.name] ?? 0, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
        if (results.length >= 12) break;
      }
      if (results.length >= 12) break;
    }
    if (!view3D) {
      for (const el of mapElements) {
        const t = ((el.title_fa || "") + " " + (el.title_en || "")).toLowerCase();
        if (!t.includes(q)) continue;
        results.push({ type: "element", id: `e-${el.id}`, name: el.title_fa, nameEn: el.title_en, emoji: getElementEmoji(el), floor: el.floor ?? 0, x: el.x, y: el.y });
        if (results.length >= 15) break;
      }
    }
    for (const zone of mapZones) {
      if (!zone.title_fa) continue;
      const t = ((zone.title_fa || "") + " " + (zone.title_en || "")).toLowerCase();
      if (!t.includes(q)) continue;
      const c = zoneCenter(zone);
      results.push({ type: "zone", id: `z-${zone.id}`, name: zone.title_fa, nameEn: zone.title_en, floor: 0, x: c.x, y: c.y });
      if (results.length >= 18) break;
    }
    return results;
  }, [searchQuery, mapData, mapElements, mapZones, hallFloors, view3D]);

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
        results.push({ type: "booth", id: `b-${booth.id}`, name: co.brand_name_fa || co.brand_name_en, hall: hall.name, no: booth.no, companyId: co.id, floor: hallFloors[hall.name] ?? 0, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
        if (results.length >= 8) break;
      }
      if (results.length >= 8) break;
    }
    if (!view3D) {
      for (const el of mapElements) {
        const t = ((el.title_fa || "") + " " + (el.title_en || "")).toLowerCase();
        if (!t.includes(q)) continue;
        results.push({ type: "element", id: `e-${el.id}`, name: el.title_fa, emoji: getElementEmoji(el), floor: el.floor ?? 0, x: el.x, y: el.y });
        if (results.length >= 10) break;
      }
    }
    for (const zone of mapZones) {
      if (!zone.title_fa) continue;
      const t = ((zone.title_fa || "") + " " + (zone.title_en || "")).toLowerCase();
      if (!t.includes(q)) continue;
      const c = zoneCenter(zone);
      results.push({ type: "zone", id: `z-${zone.id}`, name: zone.title_fa, nameEn: zone.title_en, floor: 0, x: c.x, y: c.y });
      if (results.length >= 12) break;
    }
    return results;
  }, [startQuery, mapData, mapElements, mapZones, hallFloors, view3D]);

  // ── Wayfinding helpers ─────────────────────────────────────────────────────

  function panToSvgPoint(mapX, mapY, zoomMult) {
    const el = containerRef.current;
    if (!el) return;
    const fit = fitScaleRef.current;
    const newScale = clamp(fit * (zoomMult ?? 3), minScaleRef.current, maxScaleRef.current);
    const nx = el.clientWidth  / 2 - mapX * newScale;
    const ny = el.clientHeight / 2 - mapY * newScale;
    const c = clampPan(nx, ny, newScale);
    applyT(c.x, c.y, newScale);
  }

  function selectDestination(result) {
    setNavDest({ x: result.x, y: result.y, name: result.name || result.nameEn, floor: result.floor ?? 0 });
    setNavRoute(null);
    setNavStart(null);
    setSearchQuery(result.name || result.nameEn || "");
    setSearchOpen(false);
    setStartPanelOpen(true);
    if (view3DRef.current) {
      map3DViewRef.current?.focusOnPoint(result.x, result.y);
    } else {
      panToSvgPoint(result.x, result.y);
    }
  }

  function confirmStart(startX, startY) {
    setNavStart({ x: startX, y: startY });
    setStartPanelOpen(false);
    setTapStartMode(false);
    setScanActive(false);
    stopQrScan();
    if (navDest) {
      // Show "computing" immediately so the UI updates before the synchronous
      // grid build + A* run (which can take ~1 s the first time).
      setNavRoute({ type: "computing" });

      // Capture closure values now; setTimeout fires after current paint flush.
      const sx = startX, sy = startY;
      const dest = navDest;
      const halls = hallGroups;
      const stairs = stairsElements;
      const dim = dimRef.current;

      setTimeout(() => {
        // Lazy grid build — pays the cost once per map session, then cached.
        if (!floorGridsRef.current) {
          floorGridsRef.current = buildFloorGrids(
            dim.w, dim.h, halls,
            mapData.map_signs ?? [],
            mapDoors,
            mapZones.filter(z => z.is_blocking),
            hallFloors,
            mapWalls,
          );
        }

        const startFloor = getFloorAtPoint(sx, sy, halls);
        const destFloor  = dest.floor ?? 0;
        const route = findMultiFloorRoute(
          floorGridsRef.current,
          sx, sy, startFloor,
          dest.x, dest.y, destFloor,
          stairs,
        );

        if (!route) {
          setNavRoute({ type: "no_connection" });
        } else {
          if (route.type === "no_connection" && startFloor !== destFloor) {
            // Cross-floor failure — emit details so misconfigured stairs are easy to spot
            console.warn(
              `[map] No cross-floor route: floor ${startFloor} → ${destFloor}.`,
              `Stairs on floor ${startFloor}:`,
              stairs.filter(e => (e.floor ?? 0) === startFloor)
                .map(e => `id=${e.id} linked_to=${e.linked_element_id ?? "null"}`),
            );
          }
          setNavRoute(route);
        }

        if (view3DRef.current) {
          // In 3D mode, animate the Three.js camera instead of CSS panning
          const focusPt = route?.type === "single" && route.path.length >= 2
            ? { x: route.path.reduce((s, p) => s + p.x, 0) / route.path.length,
                y: route.path.reduce((s, p) => s + p.y, 0) / route.path.length }
            : { x: sx, y: sy };
          map3DViewRef.current?.focusOnPoint(focusPt.x, focusPt.y);
        } else if (route?.type === "single" && route.path.length >= 2) {
          const xs = route.path.map(p => p.x), ys = route.path.map(p => p.y);
          panToSvgPoint((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, 1.6);
        } else if (route?.type === "multi_floor") {
          panToSvgPoint(sx, sy, 1.6);
        }
      }, 0);
    }
  }

  function clearNav() {
    setNavDest(null); setNavStart(null); setNavRoute(null);
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
        {!isHomeContext && (
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
        )}

        {mapData && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                const next = !view3D;
                view3DRef.current = next;
                setView3D(next);
                if (!next) requestAnimationFrame(() => resetView()); // only reset 2D on switch back
              }}
              aria-label="Toggle 3D view"
              className="h-9 px-3 rounded-xl flex items-center justify-center text-xs font-bold transition-all active:scale-90"
              style={{
                background: view3D ? "var(--accent)" : "var(--surface)",
                border: "1px solid var(--border)",
                color: view3D ? "#021f20" : "var(--text)",
                fontFamily: "inherit", cursor: "pointer",
              }}
            >{view3D ? "2D" : "3D"}</button>
            <button
              onClick={() => view3D ? map3DViewRef.current?.zoom(1.35) : zoomBy(1.35)}
              aria-label="Zoom in"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-xl font-bold transition-all active:scale-90"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "inherit", cursor: "pointer" }}
            >+</button>
            <button
              onClick={() => view3D ? map3DViewRef.current?.zoom(0.74) : zoomBy(0.74)}
              aria-label="Zoom out"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-xl font-bold transition-all active:scale-90"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "inherit", cursor: "pointer" }}
            >−</button>
            <button
              onClick={() => view3D ? map3DViewRef.current?.resetView() : resetView()}
              aria-label="Reset view"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-base transition-all active:scale-90"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "inherit", cursor: "pointer" }}
              title={isEN ? "Fit to screen" : "نمای کامل"}
            >⊙</button>
            <Link
              href="/companies"
              aria-label={isEN ? "Companies list" : "لیست شرکت‌ها"}
              title={isEN ? "Companies" : "شرکت‌ها"}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-base transition-all active:scale-90"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", textDecoration: "none" }}
            >🏢</Link>
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
          // Swallow clicks that were the second tap of a double-tap zoom
          if (doubleTapJustFiredRef.current) {
            doubleTapJustFiredRef.current = false;
            return;
          }
          // In 2D mode only: tap anywhere on the map to set start.
          // In 3D mode Map3DView's canvas click handler handles this instead.
          if (!view3D && tapStartMode && !dragRef.current.moved) {
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

        {/* Search bar — visible in both 2D and 3D modes */}
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
              {isEN
                ? (view3D ? "Tap a booth block to set your start point" : "Tap anywhere on the map to set your start point")
                : (view3D ? "روی یک غرفه بزنید تا موقعیت شروع تعیین شود" : "روی نقشه بزنید تا موقعیت شروع تعیین شود")}
            </div>
          </div>
        )}

        {/* CHANGE 4-E: map legend — hidden in 3D mode */}
        {mapElements.length > 0 && !view3D && (
          <MapLegend elements={mapElements} lang={lang} />
        )}

        {mapData && (
          <>
          {/* ── 3D mode: Three.js canvas fills container independently ── */}
          {view3D && (
            <Map3DView
              halls={hallGroups}
              hallColors={hallColors}
              zones={mapZones.filter((z) => z.title_fa)}
              navRoute={navRoute}
              navStart={navStart}
              navDest={navDest}
              tapStartMode={tapStartMode}
              onBoothTap={onBooth3DTap}
              onZoneTap={onZone3DTap}
              onGroundTap={(x, y) => { if (tapStartMode) confirmStart(x, y); }}
              onBackgroundTap={() => { setSelectedBooth(null); setSelectedZone(null); setSearchOpen(false); setElementTooltip(null); setSignTooltip(null); }}
              controlRef={map3DViewRef}
              selectedBoothId={selectedBooth?.booth?.company?.id ?? null}
              selectedZoneId={selectedZone?.id ?? null}
            />
          )}

          {/* ── 2D mode: CSS-transform wrapper + SVG overlay ── */}
          {!view3D && (
          <div
            ref={wrapperRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: mapW,
              height: mapH,
              transformOrigin: "0 0",
            }}
          >
          <>
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

              {/* Named zones — rendered below booths so booths appear on top */}
              {mapZones.filter((z) => z.title_fa).map((zone) => {
                const color = hallColors[zone.hall_name] || "#00ffb3";
                const isActive = selectedZone?.id === zone.id;
                const fill   = isActive ? `${color}bb` : `${color}40`;
                const stroke = isActive ? color : `${color}80`;
                const sw     = isActive ? 2 : 1.5;
                const shapeProps = {
                  fill, stroke, strokeWidth: sw,
                  style: { cursor: "pointer" },
                  onClick: (e) => onZoneClick(e, zone),
                };
                const shape  = zone.shape_type || "rectangle";
                const center = zoneCenter(zone);

                let labelFs = 12;
                if (shape === "circle") {
                  labelFs = Math.max(6, (zone.radius ?? 50) * 0.25);
                } else if (shape === "polygon" && Array.isArray(zone.points)) {
                  const xs = zone.points.map((p) => p.x), ys = zone.points.map((p) => p.y);
                  labelFs = Math.max(6, Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.12);
                } else {
                  labelFs = Math.max(6, Math.min(Math.abs((zone.x2 ?? 0) - (zone.x1 ?? 0)), Math.abs((zone.y2 ?? 0) - (zone.y1 ?? 0))) * 0.12);
                }

                return (
                  <g key={`z-${zone.id}`}>
                    {shape === "circle" ? (
                      <circle cx={zone.cx} cy={zone.cy} r={zone.radius} {...shapeProps} />
                    ) : shape === "polygon" && Array.isArray(zone.points) && zone.points.length >= 3 ? (
                      <polygon points={zone.points.map((p) => `${p.x},${p.y}`).join(" ")} {...shapeProps} />
                    ) : (
                      <rect
                        x={zone.x1} y={zone.y1}
                        width={Math.abs((zone.x2 ?? 0) - (zone.x1 ?? 0))}
                        height={Math.abs((zone.y2 ?? 0) - (zone.y1 ?? 0))}
                        {...shapeProps}
                      />
                    )}
                    <text
                      x={center.x} y={center.y}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={labelFs}
                      fontWeight="700"
                      fill={color}
                      fillOpacity={isActive ? 1 : 0.75}
                      stroke="none"
                      style={{ userSelect: "none", pointerEvents: "none" }}
                    >
                      {zone.title_fa}
                    </text>
                  </g>
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

              {/* Wall polylines intentionally not rendered here — walls are
                  invisible obstacles to users. They still block A* pathfinding
                  via buildWalkableGrid (Step 6). Admin editing is in iph-apn. */}

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
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={signFs * 1.2}
                      filter="url(#markerDrop)"
                      style={{ userSelect: "none", pointerEvents: "none" }}
                    >
                      {sign.icon || "📍"}
                    </text>
                  </g>
                );
              })}

              {/* Wayfinding route overlay — wrapped so routeLayerRef can hide it
                  during active gestures (reduces GPU compositing complexity) */}
              <g ref={routeLayerRef}>
              {navRoute && (() => {
                if (navRoute.type === "no_connection") return null;
                const strokeW = mapW / 180;
                const markerR = signR * 1.5;
                const dash = `${mapW / 70} ${mapW / 220}`;

                // Arrow geometry — sized relative to signR so they scale with zoom.
                const arrowInterval = signR * 9;
                const aL = signR * 1.05;
                const aW = signR * 0.52;
                const triPts = `${aL},0 ${-aL * 0.45},${-aW} ${-aL * 0.45},${aW}`;
                const arrowStroke = aL * 0.1;

                // Inline helper — returns flat array of <polygon> elements.
                // NOT a React component (no JSX <ArrowFn>) to avoid React unmounting
                // and remounting all arrow DOM nodes on every re-render due to unstable
                // function identity when defined inside a render closure.
                const arrowPolygons = (pts, color, keyPrefix) =>
                  routeArrows(pts, arrowInterval).map((a, i) => (
                    <polygon
                      key={`${keyPrefix}-${i}`}
                      points={triPts}
                      fill={color}
                      fillOpacity={0.95}
                      stroke="rgba(2,31,32,0.5)"
                      strokeWidth={arrowStroke}
                      strokeLinejoin="round"
                      transform={`translate(${a.x},${a.y}) rotate(${a.angle})`}
                      style={{ pointerEvents: "none" }}
                    />
                  ));

                if (navRoute.type === "single") {
                  const { path } = navRoute;
                  if (path.length < 2) return null;
                  const start = path[0], dest = path[path.length - 1];
                  return (
                    <g style={{ pointerEvents: "none" }}>
                      <polyline points={path.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#00ffb3" strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeOpacity={0.9} />
                      {arrowPolygons(path, "#00ffb3", "a")}
                      <text x={start.x} y={start.y} textAnchor="middle" dominantBaseline="central" fontSize={signFs * 1.3} filter="url(#markerDrop)" style={{ userSelect: "none" }}>🏁</text>
                      <text x={dest.x} y={dest.y} textAnchor="middle" dominantBaseline="central" fontSize={signFs * 1.4} filter="url(#markerDrop)" style={{ userSelect: "none" }}>📍</text>
                    </g>
                  );
                }

                if (navRoute.type === "multi_floor") {
                  const { pathA, pathB, stairsFrom, stairsTo } = navRoute;
                  if (pathA.length < 2 || pathB.length < 2) return null;
                  const startPt = pathA[0], destPt = pathB[pathB.length - 1];
                  return (
                    <g style={{ pointerEvents: "none" }}>
                      {/* Ground-floor segment (green) + its arrows */}
                      <polyline points={pathA.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#00ffb3" strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeOpacity={0.9} />
                      {arrowPolygons(pathA, "#00ffb3", "aa")}
                      {/* Upper-floor segment (amber) + its arrows */}
                      <polyline points={pathB.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#f59e0b" strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeOpacity={0.85} />
                      {arrowPolygons(pathB, "#f59e0b", "ab")}
                      {/* Start pin */}
                      <text x={startPt.x} y={startPt.y} textAnchor="middle" dominantBaseline="central" fontSize={signFs * 1.3} filter="url(#markerDrop)" style={{ userSelect: "none" }}>🏁</text>
                      {/* Staircase on start floor */}
                      <text x={stairsFrom.x} y={stairsFrom.y} textAnchor="middle" dominantBaseline="central" fontSize={signFs * 1.3} filter="url(#markerDrop)" style={{ userSelect: "none" }}>🪜</text>
                      {/* Staircase on dest floor */}
                      <text x={stairsTo.x} y={stairsTo.y} textAnchor="middle" dominantBaseline="central" fontSize={signFs * 1.3} filter="url(#markerDrop)" style={{ userSelect: "none" }}>🪜</text>
                      {/* Destination pin */}
                      <text x={destPt.x} y={destPt.y} textAnchor="middle" dominantBaseline="central" fontSize={signFs * 1.4} filter="url(#markerDrop)" style={{ userSelect: "none" }}>📍</text>
                    </g>
                  );
                }

                return null;
              })()}
              </g>

              {/* CHANGE 4-B: Local map elements (admin-managed) */}
              {/* Shared clip path for upload-icon markers + drop-shadow for route markers */}
              <defs>
                <clipPath id="mapElImgClip">
                  <circle r={signR * 0.95} />
                </clipPath>
                <filter id="markerDrop" x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
                  <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.72" />
                </filter>
              </defs>

              {mapElements.map((el) => {
                const isActive = elementTooltip?.el.id === el.id;
                const isUpload = el.icon_type === "upload" && el.icon_value;
                const emoji = isUpload ? null : getElementEmoji(el);
                const r = signR * 1.1;
                return (
                  <g
                    key={`me-${el.id}`}
                    transform={`translate(${el.x},${el.y})`}
                    onClick={(e) => onElementClick(e, el)}
                    style={{ cursor: "pointer" }}
                  >
                    {isUpload ? (
                      <image
                        href={el.icon_value}
                        x={-signR * 0.95}
                        y={-signR * 0.95}
                        width={signR * 1.9}
                        height={signR * 1.9}
                        clipPath="url(#mapElImgClip)"
                        preserveAspectRatio="xMidYMid meet"
                        filter="url(#markerDrop)"
                        style={{ pointerEvents: "none" }}
                      />
                    ) : (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={signFs * 1.2}
                        filter="url(#markerDrop)"
                        style={{ userSelect: "none", pointerEvents: "none" }}
                      >
                        {emoji}
                      </text>
                    )}
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
          </>
          </div>
          )}

          {/* Route info card — visible in both 2D and 3D modes */}
          {navRoute && (
            <RouteInfoCard route={navRoute} lang={lang} isRTL={isRTL} onClear={clearNav} />
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

      {/* ── Zone sheet + backdrop ── */}
      {selectedZone && (
        <>
          <div
            className="fixed inset-0 z-[53]"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onClick={() => setSelectedZone(null)}
          />
          <ZoneSheet
            zone={selectedZone}
            lang={lang}
            isRTL={isRTL}
            onClose={() => setSelectedZone(null)}
            onNavigate={() => {
              const c = zoneCenter(selectedZone);
              selectDestination({ x: c.x, y: c.y, name: selectedZone.title_fa, nameEn: selectedZone.title_en, floor: 0 });
            }}
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
