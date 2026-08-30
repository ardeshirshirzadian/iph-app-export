"use client";

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  ⚠️  CRITICAL PERFORMANCE RULES — READ BEFORE ADDING ANY NEW MAP FEATURE  ║
// ║                                                                              ║
// ║  This file has caused FOUR separate iOS Safari GPU-memory crash regressions  ║
// ║  (map elements, route arrows, walls, origin-selection backdrop-filter).       ║
// ║  Every new feature must obey ALL rules below.                                ║
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
// ║  RULE 4 — backdrop-filter elements multiply GPU work on EVERY gesture frame. ║
// ║    • When willChange="transform" is active, any backdrop-filter overlay in   ║
// ║      the DOM forces the browser to re-rasterize the full SVG compositor      ║
// ║      layer on every frame — one re-rasterize per backdrop-filter element.    ║
// ║    • onGestureStart() adds class "map-gesture-active" to pageRootRef;        ║
// ║      globals.css rule { backdrop-filter: none !important } suppresses ALL    ║
// ║      backdrop-filter elements in the DOM for the gesture duration.           ║
// ║    • No extra code needed per overlay — the CSS class covers everything.     ║
// ║    • ❌ wrong: adding a new overlay with backdrop-filter inside this          ║
// ║               component and bypassing pageRootRef (e.g. portaling to body).  ║
// ║                                                                              ║
// ║  ADDING A NEW FEATURE CHECKLIST:                                             ║
// ║    [ ] Does it add SVG/DOM nodes inside wrapperRef? → wrap them in a <g>     ║
// ║        with a ref and hide in onGestureStart/onGestureSettle (see            ║
// ║        zonesLayerRef, signsLayerRef, elementsLayerRef, routeLayerRef).       ║
// ║    [ ] Does it render a backdrop-filter overlay? → no extra code needed;     ║
// ║        auto-suppressed by .map-gesture-active class. Keep overlay INSIDE     ║
// ║        pageRootRef (don't portal to document.body).                          ║
// ║    [ ] Does it compute something on data? → useMemo with stable deps.        ║
// ║    [ ] Does it need pathfinding? → add to buildFloorGrids once, cache it.    ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import BottomNav from "../components/BottomNav";
import { useLang } from "@/lib/useLang";
import { toPersianDigits } from "@/lib/utils";
import { buildFloorGrids, findMultiFloorRoute, pathLength } from "@/lib/mapPathfinding";
import { groupOuterLoops } from "./mapUtils.js";

// Three.js/WebGL can't render server-side, and it's the single largest JS
// chunk in the build (~650K) — ssr: false plus lazy-loading keeps it off
// every route except an actual 2D->3D toggle on /map.
const Map3DView = dynamic(() => import("./Map3DView"), {
  ssr: false,
  loading: () => <Map3DViewLoading />,
});

// Mirrors the MapSkeleton visual pattern below (same pulse/glass styling)
// so the brief chunk-fetch state (first 3D toggle per session; cached after)
// doesn't look like a different loading system.
function Map3DViewLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <div className="w-10 h-10 rounded-full animate-pulse" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)" }} />
    </div>
  );
}

const RASAYESH_BASE = "https://api.rasayesh.com/";
const DRAG_THRESHOLD = 6; // px movement before a touch is treated as a drag (not a tap)

// UNUSED as of the external_3d_enabled toggle (iph-apn map/settings tab):
// Three.js/WebGL Map3DView is now the unconditional default whenever
// external_3d_enabled is false, and no longer reads this at all -- see the
// render logic below. Left declared, not wired to anything, per an explicit
// decision not to touch the env var plumbing in the same change that
// stopped consuming it; a real kill switch may replace this later.
const USE_LEGACY_MAP = process.env.NEXT_PUBLIC_USE_LEGACY_MAP === "true";

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

function isSvgIconPath(path) {
  return typeof path === "string" && path.startsWith("/") && path.toLowerCase().endsWith(".svg");
}

// Per-theme colorable SVG icon for header controls (companies-list button,
// etc.) -- same CSS mask-image + backgroundColor technique as BottomNav.js's
// nav icons and QuestClient.js's QuestIcon. Takes isLight as a prop instead
// of running its own theme MutationObserver: this file already tracks theme
// via the mapTheme state, so a second observer here would be redundant.
function HeaderIcon({ path, size, colorDark, colorLight, isLight }) {
  const color = isLight ? (colorLight || "#0f172a") : (colorDark || "#ffffff");
  return (
    <span
      style={{
        display: "block",
        width: size,
        height: size,
        flexShrink: 0,
        backgroundColor: color,
        WebkitMaskImage: `url('${path}')`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskImage: `url('${path}')`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
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

function zoneArea(zone) {
  const shape = zone.shape_type || 'rectangle';
  if (shape === 'circle') return Math.PI * (zone.radius ?? 50) ** 2;
  if (shape === 'polygon' && Array.isArray(zone.points) && zone.points.length >= 3) {
    let area = 0;
    const pts = zone.points;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
  }
  return Math.abs((zone.x2 ?? 0) - (zone.x1 ?? 0)) * Math.abs((zone.y2 ?? 0) - (zone.y1 ?? 0));
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
  return hallColors[hall.name] || hall.color || "var(--accent)";
}

// Zone fill when its hall_name has no entry in hallColors -- should only
// happen if a hall is renamed/removed from map_hall_colors after zones
// already reference it, since the admin form now prevents saving a visible
// zone without a valid hall. A hot magenta reads as "unconfigured" (the
// standard missing-texture/missing-asset color convention) rather than a
// plausible brand color -- unlike the previous #00ffb3 green, which matched
// a real hall color closely enough to go unnoticed for the Iran Cosmetica
// incident this fallback replaces.
const UNCONFIGURED_ZONE_COLOR = "#ff00ff";

// Returns an SVG path `d` string tracing only the OUTER boundary of a merged
// group as disconnected edge segments (M x,y L x,y …). Internal edges shared
// by two booth polygons are omitted. Delegates to the shared groupOuterLoops
// utility in mapUtils.js which both 2D and 3D code import.
function groupOuterEdges(booths) {
  const loops = groupOuterLoops(booths);
  const parts = [];
  for (const loop of loops) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const a = loop[i], b = loop[(i + 1) % n];
      parts.push(`M${a.x},${a.y}L${b.x},${b.y}`);
    }
  }
  return parts.join(" ");
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

function MapSearchBar({ query, setQuery, open, setOpen, results, onSelect, destName, onClearDest, lang, isRTL, labels }) {
  const isEN = lang === "en";
  const searchPh = isEN
    ? (labels?.search_placeholder_en ?? "Search booths and facilities…")
    : (labels?.search_placeholder_fa ?? "جستجوی غرفه یا امکانات…");
  return (
    <div
      className="absolute z-[25]"
      style={{ top: 8, left: 8, right: 8 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-2"
        style={{
          background: "var(--sheet-bg)", backdropFilter: "blur(20px)",
          border: "1px solid var(--border-accent)", borderRadius: 14,
          padding: "10px 14px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
        }}
      >
        <span style={{ fontSize: 15, opacity: 0.55 }}>🔍</span>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={searchPh}
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
            marginTop: 4, background: "var(--sheet-bg)", backdropFilter: "blur(20px)",
            border: "1px solid var(--border-accent)", borderRadius: 12,
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
                borderBottom: "1px solid var(--border)",
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
// List-only origin selection. Map-tap and QR-scan modes removed.

function StartPanel({ lang, isRTL, startQuery, setStartQuery, startResults, onSelectStart, onCancel, labels }) {
  const isEN = lang === "en";
  const panelTitle = isEN
    ? (labels?.origin_panel_title_en ?? "Where are you starting from?")
    : (labels?.origin_panel_title_fa ?? "نقطه شروع را انتخاب کنید");
  const searchPh = isEN
    ? (labels?.origin_search_placeholder_en ?? "Search…")
    : (labels?.origin_search_placeholder_fa ?? "جستجو…");
  return (
    <div className="fixed inset-0 z-[58] flex flex-col justify-end" style={{ direction: isRTL ? "rtl" : "ltr" }}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.42)" }} onClick={onCancel} />
      <div
        className="relative"
        style={{
          background: "var(--sheet-bg)", backdropFilter: "blur(28px)",
          borderTop: "1px solid var(--border-accent)", borderRadius: "24px 24px 0 0",
          padding: "16px 20px", paddingBottom: "calc(1.2rem + env(safe-area-inset-bottom))",
          maxHeight: "80vh", overflowY: "auto",
        }}
      >
        <div className="flex justify-center mb-4">
          <div style={{ width: 40, height: 4, background: "var(--border)", borderRadius: 2 }} />
        </div>
        <p style={{ fontWeight: 700, fontSize: 16, color: "var(--text)", marginBottom: 12 }}>
          {panelTitle}
        </p>
        <input
          value={startQuery}
          onChange={(e) => setStartQuery(e.target.value)}
          placeholder={searchPh}
          autoFocus
          style={{
            width: "100%", boxSizing: "border-box",
            background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "9px 12px", fontSize: 13,
            color: "var(--text)", fontFamily: "inherit", outline: "none",
            direction: isRTL ? "rtl" : "ltr", marginBottom: 8,
          }}
        />
        {startResults.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelectStart(r)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "9px 4px", background: "none", border: "none",
              borderBottom: "1px solid var(--border)",
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
            background: "var(--surface-2)", border: "1px solid var(--border)",
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

function RouteInfoCard({ route, lang, isRTL, onClear, is3D = false, walkActive = false, walkPaused = false, onStartNav, onStopNav, onPauseNav, onResumeNav, onStepForward, onStepBack, onNavigate }) {
  if (!route) return null;
  const isEN = lang === "en";

  // Card shell: flex-column so the clear button always occupies its own row below
  // the info content, never overlapping it regardless of text length or UI language.
  const cardStyle = {
    bottom: "calc(68px + env(safe-area-inset-bottom))", left: 8, right: 8,
    background: "var(--sheet-bg)", backdropFilter: "blur(16px)",
    borderRadius: 16,
    padding: "12px 16px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.45)",
    display: "flex", flexDirection: "column", gap: 10,
  };
  // Info row inside the card: icon + text, respects RTL text direction
  const infoRow = { display: "flex", alignItems: "center", gap: 12, direction: isRTL ? "rtl" : "ltr" };
  // Button row: always LTR so buttons sit on the RIGHT end, away from MapLegend
  // which is anchored to the left (bottom-left corner).
  const btnRow = { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, direction: "ltr" };
  const clearBtn = (
    <button
      onClick={onClear}
      style={{
        background: "var(--surface-2)", border: "1px solid var(--border)",
        borderRadius: 8, padding: "6px 14px", color: "var(--text-muted)",
        fontFamily: "inherit", fontSize: 12, cursor: "pointer", flexShrink: 0,
      }}
    >
      {isEN ? "Clear route" : "حذف مسیر"}
    </button>
  );

  if (route.type === "computing") {
    return (
      <div className="absolute z-[20]" style={{ ...cardStyle, border: "1px solid color-mix(in srgb, var(--accent) 15%, transparent)" }}>
        <div style={infoRow}>
          <span style={{ fontSize: 20 }}>🧭</span>
          <div className="animate-pulse" style={{ flex: 1, fontSize: 14, color: "var(--accent)" }}>
            {isEN ? "Calculating route…" : "در حال محاسبه مسیر…"}
          </div>
        </div>
      </div>
    );
  }

  if (route.type === "no_route") {
    return (
      <div className="absolute z-[20]" style={{ ...cardStyle, border: "1px solid rgba(249,115,22,0.4)" }}>
        <div style={infoRow}>
          <span style={{ fontSize: 22 }}>🚫</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f97316" }}>
              {isEN ? "No route found" : "مسیری یافت نشد"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {isEN ? "Could not find a path between these two points" : "مسیری بین این دو نقطه قابل محاسبه نیست"}
            </div>
          </div>
        </div>
        <div style={btnRow}>{clearBtn}</div>
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

  // Navigation controls — visible in both 2D and 3D modes.
  // 2D mode: single "▶ شروع ناوبری" button that switches to 3D then starts walkthrough.
  // 3D mode, before start: single "▶ شروع ناوبری" button (onStartNav).
  // 3D mode, during walkthrough: ⏮ step-back | ⏸/▶ pause-resume | ⏭ step-forward | ⏹ stop.
  const navBtnStyle = {
    background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 50%, transparent)",
    borderRadius: 8, padding: "6px 14px", color: "var(--accent)",
    fontFamily: "inherit", fontSize: 12, cursor: "pointer", fontWeight: 700, flexShrink: 0,
  };
  const navBtn = is3D ? (
    walkActive ? (
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button
          onClick={onStepBack}
          title={isEN ? "Previous waypoint" : "نقطه قبلی"}
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 11px", color: "var(--text)", fontFamily: "inherit", fontSize: 13, cursor: "pointer", flexShrink: 0 }}
        >⏮</button>
        <button
          onClick={walkPaused ? onResumeNav : onPauseNav}
          style={{ background: walkPaused ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "var(--surface-2)", border: `1px solid ${walkPaused ? "color-mix(in srgb, var(--accent) 50%, transparent)" : "var(--border)"}`, borderRadius: 8, padding: "6px 11px", color: walkPaused ? "var(--accent)" : "var(--text)", fontFamily: "inherit", fontSize: 12, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}
        >{walkPaused ? (isEN ? "▶ Resume" : "▶ ادامه") : (isEN ? "⏸ Pause" : "⏸ توقف")}</button>
        <button
          onClick={onStepForward}
          title={isEN ? "Next waypoint" : "نقطه بعدی"}
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 11px", color: "var(--text)", fontFamily: "inherit", fontSize: 13, cursor: "pointer", flexShrink: 0 }}
        >⏭</button>
        <button
          onClick={onStopNav}
          style={{ background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.5)", borderRadius: 8, padding: "6px 11px", color: "#f97316", fontFamily: "inherit", fontSize: 12, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}
        >{isEN ? "⏹ Stop" : "⏹ پایان"}</button>
      </div>
    ) : (
      <button onClick={onStartNav} style={navBtnStyle}>
        {isEN ? "▶ Navigate" : "▶ شروع ناوبری"}
      </button>
    )
  ) : (
    // 2D mode: Navigate button switches to 3D and starts walkthrough
    <button onClick={onNavigate} style={navBtnStyle}>
      {isEN ? "▶ Navigate" : "▶ شروع ناوبری"}
    </button>
  );

  return (
    <div className="absolute z-[20]" style={{ ...cardStyle, border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}>
      <div style={infoRow}>
        <span style={{ fontSize: 22 }}>{walkActive ? "🚶" : isMultiFloor ? "🪜" : "🧭"}</span>
        <div style={{ flex: 1 }}>
          {walkActive ? (
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>
              {isEN ? "Navigation in progress…" : "در حال ناوبری..."}
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
      <div style={btnRow}>
        {navBtn}
        {clearBtn}
      </div>
    </div>
  );
}

// ── Booth Bottom Sheet ─────────────────────────────────────────────────────────

function BoothSheet({ booth, hall, mergedLabel, lang, isRTL, onClose, onNavigate, labels }) {
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
        background: "var(--sheet-bg)",
        backdropFilter: "blur(28px)",
        borderTop: "1px solid var(--border-accent)",
        paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom))",
        maxHeight: "72vh",
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* drag handle */}
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-10 h-1 rounded-full" style={{ background: "var(--border)" }} />
      </div>

      <div className="px-5 pb-2">
        {/* company header */}
        <div className="flex items-start gap-4 mb-4">
          <div
            className="flex-shrink-0 rounded-2xl flex items-center justify-center overflow-hidden"
            style={{
              width: 64, height: 64,
              background: logoUrl ? "#fff" : "color-mix(in srgb, var(--accent) 8%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
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
                  background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                  color: "var(--accent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 15%, transparent)",
                }}
              >
                {isEN ? (f.title_en || f.title_fa) : (f.title_fa || f.title_en)}
              </span>
            ))}
          </div>
        )}

        {/* actions */}
        <div className="flex flex-col gap-2">
          {onNavigate && (
            <button
              onClick={() => { onNavigate(); onClose(); }}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
              style={{ background: "var(--accent)", color: "var(--bg)", fontFamily: "inherit", cursor: "pointer", border: "none" }}
            >
              {isEN ? (labels?.set_destination_en ?? "Set as destination") : (labels?.set_destination_fa ?? "تنظیم به‌عنوان مقصد")}
            </button>
          )}
          <div className="flex gap-2">
            {canProfile && (
              <Link
                href={`/companies/${co.slug}`}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-center transition-all active:scale-95"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
                onClick={onClose}
              >
                {isEN ? "View Profile" : "مشاهده پروفایل"}
              </Link>
            )}
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-95"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
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
    </div>
  );
}

// ── Zone Sheet ────────────────────────────────────────────────────────────────

function ZoneSheet({ zone, lang, isRTL, onClose, onNavigate, labels }) {
  const isEN = lang === "en";
  const title = isEN ? (zone.title_en || zone.title_fa) : zone.title_fa;
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[55] rounded-t-3xl"
      style={{
        background: "var(--sheet-bg)",
        backdropFilter: "blur(28px)",
        borderTop: "1px solid var(--border-accent)",
        paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom))",
      }}
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-10 h-1 rounded-full" style={{ background: "var(--border)" }} />
      </div>
      <div className="px-5 pb-2">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: "color-mix(in srgb, var(--accent) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)" }}
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
            style={{ background: "var(--accent)", color: "var(--bg)", fontFamily: "inherit", cursor: "pointer", border: "none" }}
          >
            {isEN ? (labels?.set_destination_en ?? "Set as destination") : (labels?.set_destination_fa ?? "تنظیم به‌عنوان مقصد")}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
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
        background: "var(--sheet-bg)",
        border: "1px solid var(--border-accent)",
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
        background: "var(--sheet-bg)",
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
        background: "var(--sheet-bg)",
        border: "1px solid var(--border-accent)",
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
            style={{ width: w, height: 40, background: "color-mix(in srgb, var(--accent) 8%, transparent)" }}
          />
        ))}
      </div>
      <div className="w-48 h-4 rounded-full animate-pulse" style={{ background: "color-mix(in srgb, var(--text) 6%, transparent)" }} />
      <p className="text-sm" style={{ color: "var(--text-dim)" }}>در حال بارگذاری نقشه...</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function MapClient({ title, subtitle, title_en, subtitle_en, isHomeContext = false }) {
  const { lang, isRTL } = useLang();
  const isEN = lang === "en";

  const [navCameraConfig, setNavCameraConfig] = useState({ distance: 220, height: 90, walk_speed: 75, stair_transition_duration: 0.8, arrival_fov_gain: 0 });
  const [mapAppearanceConfig, setMapAppearanceConfig] = useState(null);
  const [mapTheme, setMapTheme] = useState('dark'); // tracks 'dark'|'light' for bg color
  // Live-resolved --accent hex, read via getComputedStyle (see the mapTheme-tracking
  // effect below) -- Three.js/WebGL (Map3DView) can't resolve CSS custom properties
  // itself, unlike the 2D SVG path which references var(--accent) directly.
  const [resolvedAccent, setResolvedAccent] = useState(null);
  const [gestureHintConfig, setGestureHintConfig] = useState(null);
  const [controlIconsConfig, setControlIconsConfig] = useState(null);
  const [gestureHintImagesConfig, setGestureHintImagesConfig] = useState(null);
  const [showGestureHint, setShowGestureHint] = useState(false);
  const [routeAppearanceConfig, setRouteAppearanceConfig] = useState(null);
  const [mapLabelsConfig, setMapLabelsConfig] = useState(null);
  const [headerIconsConfig, setHeaderIconsConfig] = useState(null);
  const [navMarkerIcons, setNavMarkerIcons] = useState({
    route_start: { type: 'builtin', value: '🏁' },
    route_end: { type: 'builtin', value: '📍' },
    door_entrance: { type: 'builtin', value: '🚶' },
    door_exit: { type: 'builtin', value: '🚪' },
    door_bidirectional: { type: 'builtin', value: '↔️' },
  });
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
  const [view3D, setView3D] = useState(true);

  // Navigation state
  const [navDest, setNavDest] = useState(null);       // { x, y, name, floor }
  const [navStart, setNavStart] = useState(null);     // { x, y }
  const [navRoute, setNavRoute] = useState(null);     // result from findMultiFloorRoute
  const [startPanelOpen, setStartPanelOpen] = useState(false);
  const [walkActive, setWalkActive] = useState(false); // 3D first-person walkthrough in progress
  const [walkPaused, setWalkPaused] = useState(false); // walkthrough paused mid-route
  const pendingWalkthroughRef = useRef(false); // set by Navigate btn in 2D mode; consumed by view3D effect

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [startQuery, setStartQuery] = useState("");

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

  // gesture-simplify: active flag, debounce timer, and per-layer hide refs.
  // RULE 4: pageRootRef receives class "map-gesture-active" on gesture start,
  // which globals.css uses to disable ALL backdrop-filter in the subtree — no
  // per-overlay code required. zonesLayerRef / signsLayerRef / elementsLayerRef
  // hide the corresponding SVG detail layers (same pattern as routeLayerRef).
  const gestureActiveRef = useRef(false);
  const gestureSettleTimerRef = useRef(null);
  const pageRootRef = useRef(null);
  const routeLayerRef = useRef(null);
  const zonesLayerRef = useRef(null);
  const signsLayerRef = useRef(null);
  const elementsLayerRef = useRef(null);
  // mirrors view3D state so closures/timeouts always read the current mode
  const view3DRef    = useRef(true); // true = 3D is the default starting mode
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
        const show = fitScaleRef.current > 0 && scale > fitScaleRef.current * 3.0;
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

  // Hide detail SVG layers and suppress backdrop-filter during gestures to
  // reduce GPU compositing cost. Restored 120 ms after the gesture settles.
  //
  // TWO mechanisms work together (see RULE 4 in the header):
  //   1. SVG layer refs → visibility:hidden on zones/signs/elements/route groups.
  //   2. pageRootRef class "map-gesture-active" → globals.css disables ALL
  //      backdrop-filter in the DOM subtree (StartPanel, hint pill, zoom buttons,
  //      BoothSheet, etc.). This is the fix for the origin-selection crash: each
  //      active backdrop-filter forces a full re-rasterize of the SVG compositor
  //      layer on every gesture frame; suppressing them eliminates that overhead.
  //      Any future overlay with backdrop-filter is auto-covered — no extra code.
  function onGestureStart() {
    if (gestureSettleTimerRef.current) {
      clearTimeout(gestureSettleTimerRef.current);
      gestureSettleTimerRef.current = null;
    }
    gestureActiveRef.current = true;
    // Suppress backdrop-filter on all overlays (RULE 4)
    if (pageRootRef.current) pageRootRef.current.classList.add('map-gesture-active');
    // Hide SVG detail layers
    if (boothLabelsWrapRef.current) boothLabelsWrapRef.current.style.opacity = "0";
    if (routeLayerRef.current)    routeLayerRef.current.style.visibility = "hidden";
    if (zonesLayerRef.current)    zonesLayerRef.current.style.visibility = "hidden";
    if (signsLayerRef.current)    signsLayerRef.current.style.visibility = "hidden";
    if (elementsLayerRef.current) elementsLayerRef.current.style.visibility = "hidden";
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
      // Restore backdrop-filter (RULE 4)
      if (pageRootRef.current) pageRootRef.current.classList.remove('map-gesture-active');
      // Restore SVG detail layers
      if (routeLayerRef.current)    routeLayerRef.current.style.visibility = "";
      if (zonesLayerRef.current)    zonesLayerRef.current.style.visibility = "";
      if (signsLayerRef.current)    signsLayerRef.current.style.visibility = "";
      if (elementsLayerRef.current) elementsLayerRef.current.style.visibility = "";
      if (boothLabelsWrapRef.current) {
        const { scale } = tRef.current;
        const show = fitScaleRef.current > 0 && scale > fitScaleRef.current * 3.0;
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
    fetch("/api/map", { signal: AbortSignal.timeout(20000) })
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
        setMapData({ ...d.websiteEvent, external_3d_enabled: d.external_3d_enabled, external_3d_url: d.external_3d_url });
        if (d.hallColors) setHallColors(d.hallColors);
        if (d.hallFloors) setHallFloors(d.hallFloors);
        if (d.mapElements) setMapElements(d.mapElements);
        if (d.mapZones) setMapZones(d.mapZones);
        if (d.mapWalls) setMapWalls(d.mapWalls);
        if (d.mapDoors) setMapDoors(d.mapDoors);
        if (d.navCameraConfig) setNavCameraConfig(d.navCameraConfig);
        if (d.navMarkerIcons) setNavMarkerIcons(prev => ({ ...prev, ...d.navMarkerIcons }));
        if (d.mapAppearanceConfig) setMapAppearanceConfig(d.mapAppearanceConfig);
        if (d.gestureHintConfig)      setGestureHintConfig(d.gestureHintConfig);
        if (d.controlIconsConfig)     setControlIconsConfig(d.controlIconsConfig);
        if (d.gestureHintImagesConfig) setGestureHintImagesConfig(d.gestureHintImagesConfig);
        if (d.routeAppearanceConfig)  setRouteAppearanceConfig(d.routeAppearanceConfig);
        if (d.mapLabelsConfig)        setMapLabelsConfig(d.mapLabelsConfig);
        if (d.headerIconsConfig)      setHeaderIconsConfig(d.headerIconsConfig);
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

  // Gesture hint: show on 3D mode entry. display_mode controls frequency:
  //   'once' (default) — only on first ever visit, persisted in localStorage.
  //   'always' — every time the user enters 3D mode.
  const hintTimerRef = useRef(null);
  const hintShownRef = useRef(false); // prevents double-show within a single 3D session
  function dismissGestureHint() {
    setShowGestureHint(false);
    if (hintTimerRef.current) { clearTimeout(hintTimerRef.current); hintTimerRef.current = null; }
    try { localStorage.setItem('iph_map3d_hint_seen', '1'); } catch {}
  }
  useEffect(() => {
    if (!view3D || externalPlanActive) {
      // Allow hint to show again next time 3D mode is entered (for 'always' mode).
      // externalPlanActive is folded in here too: while the admin-configured external
      // 3D embed is showing, this app's own gesture-based pan/zoom/rotate hint is
      // irrelevant (same reasoning as the search bar / zoom button stack above), so
      // it's treated the same as not being in 3D mode at all -- no fire, no timer.
      if ((gestureHintConfig?.display_mode ?? 'once') === 'always') {
        hintShownRef.current = false;
        setShowGestureHint(false);
      }
      return;
    }
    if (hintShownRef.current) return;
    if (!(gestureHintConfig?.enabled ?? true)) return;
    const mode = gestureHintConfig?.display_mode ?? 'once';
    if (mode === 'once') {
      try { if (localStorage.getItem('iph_map3d_hint_seen')) return; } catch {}
    }
    hintShownRef.current = true;
    setShowGestureHint(true);
    hintTimerRef.current = setTimeout(dismissGestureHint, 5000);
    return () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view3D, gestureHintConfig]);

  // Track current theme ('dark'|'light') so 3D scene background updates when theme switches.
  // Reads the 'light' class applied to <html> by ThemeSync.js. Also resolves the live
  // --accent hex here (same DOM read, same timing) for Map3DView's WebGL color props,
  // which can't reference CSS custom properties the way the 2D SVG path can.
  //
  // useLayoutEffect (not useEffect) is required so this runs before the browser paints --
  // otherwise the fallback-literal route/hall colors would be visible for a frame before
  // correcting. Map3DView itself is ssr:false (see the dynamic() import above), so there's
  // no SSR output to hydration-mismatch against; MapClient's own SSR output doesn't depend
  // on resolvedAccent (only the 2D SVG's var(--accent) references, resolved by the browser).
  useLayoutEffect(() => {
    const update = () => {
      setMapTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
      setResolvedAccent(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    };
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);


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
      if (!zone.title_fa || zone.is_visible === false) continue;
      const t = ((zone.title_fa || "") + " " + (zone.title_en || "")).toLowerCase();
      if (!t.includes(q)) continue;
      const c = zoneCenter(zone);
      results.push({ type: "zone", id: `z-${zone.id}`, name: zone.title_fa, nameEn: zone.title_en, floor: hallFloors[zone.hall_name] ?? 0, x: c.x, y: c.y });
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
      if (!zone.title_fa || zone.is_visible === false) continue;
      const t = ((zone.title_fa || "") + " " + (zone.title_en || "")).toLowerCase();
      if (!t.includes(q)) continue;
      const c = zoneCenter(zone);
      results.push({ type: "zone", id: `z-${zone.id}`, name: zone.title_fa, nameEn: zone.title_en, floor: hallFloors[zone.hall_name] ?? 0, x: c.x, y: c.y });
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

  function confirmStart(startX, startY, startFloorHint = null) {
    setNavStart({ x: startX, y: startY });
    setStartPanelOpen(false);
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

        // Prefer the floor carried from the search result (zones/booths include it).
        // Fall back to coordinate-based detection for ground taps or unknown origins.
        const startFloor = startFloorHint != null ? startFloorHint : getFloorAtPoint(sx, sy, halls);
        const destFloor  = dest.floor ?? 0;
        const route = findMultiFloorRoute(
          floorGridsRef.current,
          sx, sy, startFloor,
          dest.x, dest.y, destFloor,
          stairs,
        );

        if (!route) {
          // Same-floor A* returned null — no path exists between the two points in the grid.
          // Use a distinct type so the UI can show an accurate message instead of the
          // floor-connection message (which is only correct for the multi-floor case).
          setNavRoute({ type: "no_route" });
        } else {
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
    if (walkActive) {
      map3DViewRef.current?.stopWalkthrough();
      setWalkActive(false);
      setWalkPaused(false);
    }
    setNavDest(null); setNavStart(null); setNavRoute(null);
    setStartPanelOpen(false);
    setSearchQuery(""); setSearchOpen(false);
  }

  // ── Derived map geometry ───────────────────────────────────────────────────

  // Theme-specific 3D scene background from admin config (A4)
  const mapBgColor = mapTheme === 'light'
    ? (mapAppearanceConfig?.background?.light ?? '#e8f5f0')
    : (mapAppearanceConfig?.background?.dark  ?? '#021f20');

  // Theme-resolved route/navigation colors (fallback to hardcoded defaults if unset).
  // Memoized so the object identity is stable across renders — a new object on every
  // render would spuriously re-trigger Map3DView's route effect (which stops any
  // in-progress walkthrough) whenever MapClient re-renders (e.g. setWalkActive).
  const routeColors = useMemo(() => {
    const themeConfig = routeAppearanceConfig?.[mapTheme];
    const defaults = mapTheme === 'light'
      ? { routeLine: '#007755', routeArrow: '#007755', walkthroughHalo: '#007755', walkthroughStripe: '#007755' }
      : { routeLine: '#00ffb3', routeArrow: '#00ffb3', walkthroughHalo: '#00ffb3', walkthroughStripe: '#00ffb3' };
    const merged = { ...defaults, ...(themeConfig?.primary ?? {}) };
    // 'primary' route colors should track the event's own accent when the admin hasn't
    // set an explicit override -- same "still equals the literal default" check used
    // elsewhere today. 'secondary' (cross-floor segment color, amber) is intentionally
    // theme/accent-independent -- see ROUTE_FIELDS labels in iph-apn's map admin page,
    // it exists specifically to contrast with primary, not to match branding.
    if (resolvedAccent) {
      for (const key of Object.keys(defaults)) {
        if (merged[key] === defaults[key]) merged[key] = resolvedAccent;
      }
    }
    return merged;
  }, [mapTheme, routeAppearanceConfig, resolvedAccent]);

  const routeColorsSecondary = useMemo(() => {
    const themeConfig = routeAppearanceConfig?.[mapTheme];
    const defaults = mapTheme === 'light'
      ? { routeLine: '#d97706', routeArrow: '#d97706', walkthroughHalo: '#d97706', walkthroughStripe: '#d97706' }
      : { routeLine: '#f59e0b', routeArrow: '#f59e0b', walkthroughHalo: '#f59e0b', walkthroughStripe: '#f59e0b' };
    return { ...defaults, ...(themeConfig?.secondary ?? {}) };
  }, [mapTheme, routeAppearanceConfig]);

  const { w: mapW, h: mapH } = dimRef.current;
  const planUrl = mapData ? getPlanUrl(mapData.bare_plan) : null;
  // sign circle / font size relative to map coordinate space
  const signR = mapW / 70;
  const signFs = mapW / 55;

  // Admin-configured external 3D embed (iph-apn map/settings tab). externalPlanPath
  // is derived from the stored URL (validated server-side to be under
  // https://3dplan.rasayesh.com) so it routes through app/plan/[...path]/route.js
  // exactly like Map3DView's own asset loading is same-origin -- never the raw
  // external_3d_url directly in the iframe src. externalPlanActive only goes true
  // once the URL actually parses, so a malformed stored value falls through to
  // Map3DView (search bar and the circular buttons included) instead of hiding
  // them for a URL that won't render.
  //
  // externalPlanConfigured is the same "URL actually parses" check WITHOUT the
  // `view3D &&` gate -- it must stay true even while view3D is (momentarily)
  // false, because it's what guards 2D from ever being reachable below. Gating
  // it on view3D too would make it self-defeating: the instant 2D is entered,
  // externalPlanConfigured would flip false and nothing would force 3D back.
  let externalPlanConfiguredPath = null;
  if (mapData?.external_3d_enabled === true && mapData?.external_3d_url) {
    try {
      const u = new URL(mapData.external_3d_url);
      externalPlanConfiguredPath = u.pathname + u.search;
    } catch {
      externalPlanConfiguredPath = null;
    }
  }
  const externalPlanConfigured = !!externalPlanConfiguredPath;

  const externalPlanPath = view3D ? externalPlanConfiguredPath : null;
  const externalPlanActive = !!externalPlanPath;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={pageRootRef}
      className="flex flex-col"
      style={{ height: "100dvh", background: "var(--bg)", overflow: "hidden" }}
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
    >
      {/* ── Page header ── */}
      <div
        className="flex-shrink-0"
        style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", zIndex: 20 }}
      >
        {/* Single PageHeader call handles both the standard app header (logo +
            notifications + cart) and the title/subtitle + 3D/zoom/companies
            controls row, same as every other page -- previously this was a
            bespoke duplicate of PageHeader's own markup (including its own
            copy of the now-fixed empty-title-swallowed-by-hardcoded-default
            bug). titleRowExtra carries the button group; showBack is false
            to preserve this page's existing no-back-button behavior. */}
        <div className="px-4 pb-3">
          <PageHeader
            title={title}
            subtitle={subtitle}
            title_en={title_en}
            subtitle_en={subtitle_en}
            isHomeContext={isHomeContext}
            showBack={false}
            titleRowExtra={mapData && (
              <>
                {/* Hidden entirely while an external 3D embed is configured -- 2D must
                    stay unreachable, not just default-off. See externalPlanConfigured
                    above; the onClick guard is defense-in-depth in case this ever
                    renders from another path, since it's otherwise unreachable here. */}
                {!externalPlanConfigured && (
                  <button
                    onClick={() => {
                      if (externalPlanConfigured) return;
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
                      color: view3D ? "var(--bg)" : "var(--text)",
                      fontFamily: "inherit", cursor: "pointer",
                    }}
                  >{view3D ? "2D" : "3D"}</button>
                )}
                <Link
                  href="/companies"
                  aria-label={isEN ? "Companies list" : "لیست شرکت‌ها"}
                  title={isEN ? "Companies" : "شرکت‌ها"}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-base transition-all active:scale-90"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", textDecoration: "none" }}
                >
                  {(() => {
                    const ci = headerIconsConfig?.companiesList || { icon: "🏢", icon_size: 20 };
                    if (ci.icon && ci.icon.startsWith("/")) {
                      return isSvgIconPath(ci.icon)
                        ? <HeaderIcon path={ci.icon} size={ci.icon_size} colorDark={ci.color_dark} colorLight={ci.color_light} isLight={mapTheme === "light"} />
                        : <img src={ci.icon} alt="" style={{ width: ci.icon_size, height: ci.icon_size, objectFit: "contain" }} />;
                    }
                    return <span style={{ fontSize: ci.icon_size, lineHeight: 1 }}>{ci.icon}</span>;
                  })()}
                </Link>
              </>
            )}
          />
        </div>
      </div>

      {/* ── Map container ── */}
      {/* marginBottom reserves space for the fixed BottomNav below: BottomNav is
          position:fixed (out of flow) so flex-1 alone would let this container's
          box (and every absolute inset-0 child -- 2D img/svg, iframe, Map3DView's
          Three.js mount div -- all of which size off this container's clientHeight)
          extend under it. Margin (not padding) is required: abs-positioned inset-0
          children are contained by the padding box of their positioned ancestor, so
          padding here would be ignored by them. */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        style={{ touchAction: "none", cursor: "grab", userSelect: "none", marginBottom: "calc(53px + env(safe-area-inset-bottom))" }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={(e) => {
          // Swallow clicks that were the second tap of a double-tap zoom
          if (doubleTapJustFiredRef.current) {
            doubleTapJustFiredRef.current = false;
            return;
          }
          setSelectedBooth(null); setSignTooltip(null); setElementTooltip(null); setSearchOpen(false);
        }}
      >
        {/* background glows */}
        <div className="dark-only absolute top-0 right-0 w-72 h-72 rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(0,255,179,0.03)", zIndex: 0 }} />

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

        {/* Search bar — visible in both 2D and 3D modes, except the admin-configured */}
        {/* external 3D embed (map/settings tab in iph-apn), which has its own UI. */}
        {mapData && !externalPlanActive && (
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
            labels={mapLabelsConfig}
          />
        )}

        {/* Floating zoom + reset-view buttons — hidden during first-person walkthrough */}
        {/* and during the admin-configured external 3D embed (its own UI handles this). */}
        {mapData && !(view3D && walkActive) && !externalPlanActive && (
          <div
            className="absolute z-[24] flex flex-col gap-2"
            style={{ right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          >
            <button
              onClick={(e) => { e.stopPropagation(); view3D ? map3DViewRef.current?.zoom(1.35) : zoomBy(1.35); }}
              aria-label="Zoom in"
              className="w-11 h-11 rounded-full flex items-center justify-center text-xl font-bold transition-all active:scale-90"
              style={{
                background: "var(--nav-bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontFamily: "inherit", cursor: "pointer",
                boxShadow: "0 2px 14px rgba(0,0,0,0.45)",
                backdropFilter: "blur(8px)",
                pointerEvents: "auto",
              }}
            >
              {controlIconsConfig?.[mapTheme]?.zoomIn
                ? <img src={controlIconsConfig[mapTheme].zoomIn} alt="+" style={{ width: 22, height: 22, objectFit: "contain" }} />
                : "+"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); view3D ? map3DViewRef.current?.zoom(0.74) : zoomBy(0.74); }}
              aria-label="Zoom out"
              className="w-11 h-11 rounded-full flex items-center justify-center text-xl font-bold transition-all active:scale-90"
              style={{
                background: "var(--nav-bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontFamily: "inherit", cursor: "pointer",
                boxShadow: "0 2px 14px rgba(0,0,0,0.45)",
                backdropFilter: "blur(8px)",
                pointerEvents: "auto",
              }}
            >
              {controlIconsConfig?.[mapTheme]?.zoomOut
                ? <img src={controlIconsConfig[mapTheme].zoomOut} alt="−" style={{ width: 22, height: 22, objectFit: "contain" }} />
                : "−"}
            </button>
            {/* Compass: reset idle 3D camera angle — 3D-only, hidden in 2D mode */}
            {view3D && (
              <button
                onClick={(e) => { e.stopPropagation(); map3DViewRef.current?.resetView(); }}
                aria-label="Reset view angle"
                className="w-11 h-11 rounded-full flex items-center justify-center text-base transition-all active:scale-90"
                style={{
                  background: "var(--nav-bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontFamily: "inherit", cursor: "pointer",
                  boxShadow: "0 2px 14px rgba(0,0,0,0.45)",
                  backdropFilter: "blur(8px)",
                  pointerEvents: "auto",
                }}
                title={isEN ? "Reset view angle" : "بازگشت به زاویه پیش‌فرض"}
              >
                {controlIconsConfig?.[mapTheme]?.compass
                  ? <img src={controlIconsConfig[mapTheme].compass} alt="compass" style={{ width: 22, height: 22, objectFit: "contain" }} />
                  : "🧭"}
              </button>
            )}
          </div>
        )}

        {/* CHANGE 4-E: map legend — hidden in 3D mode */}
        {mapElements.length > 0 && !view3D && (
          <MapLegend elements={mapElements} lang={lang} />
        )}

        {mapData && (
          <>
          {/* ── 3D mode: admin-configured external embed (iph-apn map/settings   ── */}
          {/* ── tab) when set, proxied same-origin -- see app/plan/[...path]/       */}
          {/* route.js. Otherwise the internal Three.js render below, now the real  */}
          {/* default (unconditional, not gated on NEXT_PUBLIC_USE_LEGACY_MAP --    */}
          {/* see that const's declaration comment near the top of this file).      */}
          {view3D && (
            externalPlanActive ? (
              <iframe
                key={mapData.external_3d_url}
                src={externalPlanPath}
                title={isEN ? "3D exhibition floor plan" : "نقشه سه‌بعدی نمایشگاه"}
                loading="lazy"
                allow="fullscreen"
                className="absolute inset-0 w-full h-full"
                style={{ border: 0 }}
              />
            ) : (
            <Map3DView
              halls={hallGroups}
              hallColors={hallColors}
              hallFloors={hallFloors}
              zones={mapZones.filter((z) => z.title_fa && z.is_visible !== false)}
              navRoute={navRoute}
              navStart={navStart}
              navDest={navDest}
              navCameraConfig={navCameraConfig}
              navMarkerIcons={navMarkerIcons}
              idleCameraConfig={mapAppearanceConfig}
              bgColor={mapBgColor}
              onGestureStart={onGestureStart}
              onGestureEnd={onGestureSettle}
              routeColors={routeColors}
              routeColorsSecondary={routeColorsSecondary}
              resolvedAccentColor={resolvedAccent}
              tapStartMode={false}
              onBoothTap={onBooth3DTap}
              onZoneTap={onZone3DTap}
              onGroundTap={() => {}}
              onBackgroundTap={() => { setSelectedBooth(null); setSelectedZone(null); setSearchOpen(false); setElementTooltip(null); setSignTooltip(null); }}
              controlRef={map3DViewRef}
              selectedBoothId={selectedBooth?.booth?.company?.id ?? null}
              selectedZoneId={selectedZone?.id ?? null}
              lang={lang}
              boothLabelThreshold={mapLabelsConfig?.booth_label_zoom_threshold ?? 600}
              onReady={() => {
                if (!pendingWalkthroughRef.current) return;
                pendingWalkthroughRef.current = false;
                // rAF fires after all effects in this commit (including route effect that
                // builds walkthroughPath) have run, making the trigger deterministic.
                requestAnimationFrame(() => {
                  if (map3DViewRef.current?.startWalkthrough(() => {
                    setWalkActive(false);
                    setWalkPaused(false);
                  })) {
                    setWalkActive(true);
                    setWalkPaused(false);
                  }
                });
              }}
            />
            )
          )}

          {/* ── One-time gesture hint (3D mode, first visit) ─────────────── */}
          {/* RULE 4 compliance: no backdrop-filter — uses solid rgba background  */}
          {/* so it stays crisp during gestures without extra GPU compositing.   */}
          {view3D && showGestureHint && !externalPlanActive && (
            <div
              onClick={dismissGestureHint}
              style={{
                position: 'absolute',
                bottom: 90,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(2, 31, 32, 0.92)',
                border: '1px solid rgba(0, 255, 179, 0.25)',
                borderRadius: 16,
                padding: '14px 22px',
                zIndex: 35,
                cursor: 'pointer',
                pointerEvents: 'auto',
                userSelect: 'none',
                minWidth: 220,
                maxWidth: 300,
                boxShadow: '0 4px 24px rgba(0,0,0,0.55)',
              }}
              dir={isEN ? 'ltr' : 'rtl'}
              aria-label={isEN ? 'Gesture guide — tap to dismiss' : 'راهنمای اشاره‌گر — لمس کنید تا بسته شود'}
            >
              {(() => {
                const text = gestureHintConfig
                  ? (isEN ? gestureHintConfig.en : gestureHintConfig.fa)
                  : (isEN
                    ? '☝️ One finger: move map\n✌️ Two fingers: rotate + zoom'
                    : '☝️ یک انگشت: جابجایی نقشه\n✌️ دو انگشت: چرخش و زوم');
                const lines = text.split('\n').filter(Boolean);
                const hintImgs = gestureHintImagesConfig?.[mapTheme];
                const imgKeys = ['oneFinger', 'twoFinger'];
                return lines.map((line, i) => {
                  const imgUrl = hintImgs?.[imgKeys[i]];
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: i < lines.length - 1 ? 8 : 0 }}>
                      {imgUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imgUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0, borderRadius: 6 }} />
                      )}
                      <span style={{ fontSize: 13, color: '#ffffff', lineHeight: 1.9 }}>{line}</span>
                    </div>
                  );
                });
              })()}
              <div style={{ fontSize: 11, color: 'color-mix(in srgb, var(--accent) 55%, transparent)', marginTop: 8, textAlign: 'center' }}>
                {isEN ? 'Tap to dismiss' : 'برای بستن لمس کنید'}
              </div>
            </div>
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

              {/* Named zones — below booths (booths appear on top).
                  Fills and labels are visual-only (pointerEvents:none); click
                  handling is done by the transparent hit overlays rendered after
                  booths so zones are always tappable even when booth polygons
                  cover the zone area.
                  Wrapped in zonesLayerRef so onGestureStart can hide them to
                  reduce per-frame GPU paint work during active gestures.
                  Sorted by area descending: large zones rendered first (bottom),
                  small zones last (top) so their labels stay visible. */}
              <g ref={zonesLayerRef}>
              {[...mapZones.filter((z) => z.title_fa && z.is_visible !== false)]
                .sort((a, b) => zoneArea(b) - zoneArea(a))
                .map((zone) => {
                const color = hallColors[zone.hall_name] || UNCONFIGURED_ZONE_COLOR;
                const isActive = selectedZone?.id === zone.id;
                const fill   = isActive ? `${color}bb` : `${color}40`;
                const stroke = isActive ? color : `${color}80`;
                const sw     = isActive ? 2 : 1.5;
                const shapeProps = {
                  fill, stroke, strokeWidth: sw,
                  style: { pointerEvents: "none" }, // visual only — hits handled below
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
              </g>{/* end zonesLayerRef */}

              {/* Booths */}
              {hallGroups.flatMap((hall) =>
                hall.groups.flatMap((group) => {
                  const isMerged = group.type === "merged";
                  const isVacant = group.type === "vacant";
                  const active = !isVacant && selectedBooth
                    && selectedBooth.booth.company?.id === group.company?.id;
                  const hc = getHallColor(hall, hallColors);

                  // Individual booth fill polygons
                  const els = group.booths.map((booth) => {
                    const pts = toPoints(booth.bounds);
                    if (!pts) return null;
                    return (
                      <polygon
                        key={`b-${booth.id}`}
                        points={pts}
                        fill={
                          active
                            ? `${hc}aa`
                            : !isVacant
                            ? `${hc}40`
                            : "rgba(255,255,255,0.04)"
                        }
                        stroke={
                          isMerged
                            ? "none"            // always suppress internal dividers; outer path handles the border
                            : active
                            ? hc
                            : !isVacant
                            ? `${hc}80`
                            : "rgba(255,255,255,0.15)"
                        }
                        strokeWidth={active ? 3.5 : 2.5}
                        style={{ cursor: !isVacant ? "pointer" : "default" }}
                        onClick={(e) =>
                          isMerged
                            ? onGroupClick(e, group, hall)
                            : onBoothClick(e, booth, hall)
                        }
                      />
                    );
                  });

                  // For merged groups: draw a single path tracing only the outer boundary
                  // (shared internal edges are omitted, so no internal dividers appear)
                  if (isMerged) {
                    const outerPath = groupOuterEdges(group.booths);
                    if (outerPath) {
                      els.push(
                        <path
                          key={`gb-${group.company.id}`}
                          d={outerPath}
                          fill="none"
                          stroke={active ? hc : `${hc}80`}
                          strokeWidth={active ? 4 : 2.5}
                          strokeLinecap="round"
                          style={{ pointerEvents: "none" }}
                        />
                      );
                    }
                  }

                  return els;
                })
              )}

              {/* Zone hit overlays — rendered after booth polygons so zone taps register
                  even when booth polygons visually cover the zone area.
                  fill="transparent" makes each shape fully hit-testable but invisible.
                  Sorted by descending area: largest zones rendered first, smallest last
                  (last = topmost in SVG z-order = highest click priority), so a small
                  specific zone inside a large zone boundary always wins the tap. */}
              <g>
              {[...mapZones.filter((z) => z.title_fa && z.is_visible !== false)]
                .sort((a, b) => zoneArea(b) - zoneArea(a))
                .map((zone) => {
                  const shape = zone.shape_type || "rectangle";
                  const hitProps = {
                    fill: "transparent",
                    stroke: "none",
                    style: { cursor: "pointer" },
                    onClick: (e) => onZoneClick(e, zone),
                  };
                  return (
                    <g key={`zh-${zone.id}`}>
                      {shape === "circle" ? (
                        <circle cx={zone.cx} cy={zone.cy} r={zone.radius ?? 50} {...hitProps} />
                      ) : shape === "polygon" && Array.isArray(zone.points) && zone.points.length >= 3 ? (
                        <polygon points={zone.points.map((p) => `${p.x},${p.y}`).join(" ")} {...hitProps} />
                      ) : (
                        <rect
                          x={zone.x1} y={zone.y1}
                          width={Math.abs((zone.x2 ?? 0) - (zone.x1 ?? 0))}
                          height={Math.abs((zone.y2 ?? 0) - (zone.y1 ?? 0))}
                          {...hitProps}
                        />
                      )}
                    </g>
                  );
                })}
              </g>

              {/* Wall polylines intentionally not rendered here — walls are
                  invisible obstacles to users. They still block A* pathfinding
                  via buildWalkableGrid (Step 6). Admin editing is in iph-apn. */}

              {/* Map signs — wrapped in signsLayerRef so onGestureStart hides them */}
              <g ref={signsLayerRef}>
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
              </g>{/* end signsLayerRef */}

              {/* Wayfinding route overlay — wrapped so routeLayerRef can hide it
                  during active gestures (reduces GPU compositing complexity) */}
              <g ref={routeLayerRef}>
              {navRoute && (() => {
                if (navRoute.type === "no_connection" || navRoute.type === "no_route") return null;
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
                // Render a nav pin (emoji text or uploaded image) at (px, py)
                const svgNavPin = (px, py, iconObj, fs, key) => {
                  if (iconObj?.type === 'upload' && iconObj.value) {
                    const sz = fs * 1.6;
                    return (
                      <image
                        key={key}
                        href={iconObj.value}
                        x={px - sz / 2} y={py - sz / 2}
                        width={sz} height={sz}
                        filter="url(#markerDrop)"
                        style={{ pointerEvents: 'none' }}
                      />
                    );
                  }
                  const emoji = iconObj?.value ?? (iconObj?.type === 'builtin' ? iconObj.value : null);
                  return (
                    <text key={key} x={px} y={py} textAnchor="middle" dominantBaseline="central"
                      fontSize={fs} filter="url(#markerDrop)" style={{ userSelect: 'none' }}>
                      {emoji}
                    </text>
                  );
                };

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
                      <polyline points={path.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={routeColors.routeLine} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeOpacity={0.9} />
                      {arrowPolygons(path, routeColors.routeArrow, "a")}
                      {svgNavPin(start.x, start.y, navMarkerIcons.route_start, signFs * 1.3, "pin-start")}
                      {svgNavPin(dest.x, dest.y, navMarkerIcons.route_end, signFs * 1.4, "pin-dest")}
                    </g>
                  );
                }

                if (navRoute.type === "multi_floor") {
                  const { pathA, pathB, stairsFrom, stairsTo } = navRoute;
                  if (pathA.length < 2 || pathB.length < 2) return null;
                  const startPt = pathA[0], destPt = pathB[pathB.length - 1];
                  return (
                    <g style={{ pointerEvents: "none" }}>
                      {/* Ground-floor segment + its arrows */}
                      <polyline points={pathA.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={routeColors.routeLine} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeOpacity={0.9} />
                      {arrowPolygons(pathA, routeColors.routeArrow, "aa")}
                      {/* Upper-floor segment — secondary (cross-floor) colors from admin config */}
                      <polyline points={pathB.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={routeColorsSecondary.routeLine} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeOpacity={0.85} />
                      {arrowPolygons(pathB, routeColorsSecondary.routeArrow, "ab")}
                      {/* Start pin */}
                      {svgNavPin(startPt.x, startPt.y, navMarkerIcons.route_start, signFs * 1.3, "pin-start-mf")}
                      {/* Staircase on start floor */}
                      <text x={stairsFrom.x} y={stairsFrom.y} textAnchor="middle" dominantBaseline="central" fontSize={signFs * 1.3} filter="url(#markerDrop)" style={{ userSelect: "none" }}>🪜</text>
                      {/* Staircase on dest floor */}
                      <text x={stairsTo.x} y={stairsTo.y} textAnchor="middle" dominantBaseline="central" fontSize={signFs * 1.3} filter="url(#markerDrop)" style={{ userSelect: "none" }}>🪜</text>
                      {/* Destination pin */}
                      {svgNavPin(destPt.x, destPt.y, navMarkerIcons.route_end, signFs * 1.4, "pin-dest-mf")}
                    </g>
                  );
                }

                return null;
              })()}
              </g>

              {/* CHANGE 4-B: Local map elements (admin-managed) */}
              {/* Shared clip path for upload-icon markers + drop-shadow for route markers.
                  defs stay outside elementsLayerRef so IDs remain resolvable even
                  while the elements layer is hidden during gestures. */}
              <defs>
                <clipPath id="mapElImgClip">
                  <circle r={signR * 0.95} />
                </clipPath>
                <filter id="markerDrop" x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
                  <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.72" />
                </filter>
              </defs>

              {/* Map elements — wrapped in elementsLayerRef so onGestureStart hides them */}
              <g ref={elementsLayerRef}>
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
              </g>{/* end elementsLayerRef */}
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

          {/* Route info card — visible in both 2D and 3D modes.
              In 3D mode the card also shows the "شروع ناوبری" walkthrough button. */}
          {navRoute && (
            <RouteInfoCard
              route={navRoute}
              lang={lang}
              isRTL={isRTL}
              onClear={clearNav}
              is3D={view3D}
              walkActive={walkActive}
              walkPaused={walkPaused}
              onNavigate={() => {
                if (view3DRef.current) {
                  // Already in 3D — start walkthrough directly
                  if (map3DViewRef.current?.startWalkthrough(() => {
                    setWalkActive(false);
                    setWalkPaused(false);
                  })) {
                    setWalkActive(true);
                    setWalkPaused(false);
                  }
                  return;
                }
                // Switch to 3D and queue walkthrough start once Map3DView mounts
                pendingWalkthroughRef.current = true;
                view3DRef.current = true;
                setView3D(true);
              }}
              onStartNav={() => {
                if (map3DViewRef.current?.startWalkthrough(() => {
                  setWalkActive(false);
                  setWalkPaused(false);
                })) {
                  setWalkActive(true);
                  setWalkPaused(false);
                }
              }}
              onStopNav={() => {
                map3DViewRef.current?.stopWalkthrough();
                setWalkActive(false);
                setWalkPaused(false);
              }}
              onPauseNav={() => {
                map3DViewRef.current?.pauseWalkthrough();
                setWalkPaused(true);
              }}
              onResumeNav={() => {
                map3DViewRef.current?.resumeWalkthrough();
                setWalkPaused(false);
              }}
              onStepForward={() => map3DViewRef.current?.stepForward()}
              onStepBack={() => map3DViewRef.current?.stepBack()}
            />
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
            labels={mapLabelsConfig}
            onClose={() => setSelectedBooth(null)}
            onNavigate={selectedBooth.booth.bounds?.length ? () => {
              const pts = selectedBooth.booth.bounds;
              const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
              const co = selectedBooth.booth.company;
              selectDestination({
                x: (Math.min(...xs) + Math.max(...xs)) / 2,
                y: (Math.min(...ys) + Math.max(...ys)) / 2,
                name: co?.brand_name_fa || co?.brand_name_en || `غرفه ${selectedBooth.booth.no}`,
                nameEn: co?.brand_name_en || co?.brand_name_fa || `Booth ${selectedBooth.booth.no}`,
                floor: hallFloors[selectedBooth.hall.name] ?? 0,
              });
            } : undefined}
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
            labels={mapLabelsConfig}
            onClose={() => setSelectedZone(null)}
            onNavigate={() => {
              const c = zoneCenter(selectedZone);
              selectDestination({ x: c.x, y: c.y, name: selectedZone.title_fa, nameEn: selectedZone.title_en, floor: hallFloors[selectedZone.hall_name] ?? 0 });
            }}
          />
        </>
      )}

      {/* ── Start point panel ── */}
      {startPanelOpen && (
        <StartPanel
          lang={lang}
          isRTL={isRTL}
          startQuery={startQuery}
          setStartQuery={setStartQuery}
          startResults={startSearchResults}
          onSelectStart={(r) => confirmStart(r.x, r.y, r.floor ?? null)}
          onCancel={clearNav}
          labels={mapLabelsConfig}
        />
      )}

      <BottomNav />
    </div>
  );
}
