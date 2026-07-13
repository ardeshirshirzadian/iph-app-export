"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import { useLang } from "@/lib/useLang";
import { toPersianDigits } from "@/lib/utils";

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

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

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

  const containerRef = useRef(null);
  const wrapperRef = useRef(null); // receives CSS transform
  const tRef = useRef({ x: 0, y: 0, scale: 1 }); // live transform (no state, direct DOM)
  const minScaleRef = useRef(0.05);
  const maxScaleRef = useRef(4);
  const dimRef = useRef({ w: 1000, h: 700 });

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
        if (d.errors?.length) {
          console.error("[MapClient] GraphQL errors:", d.errors);
          setError("GraphQL: " + d.errors[0].message);
          return;
        }
        if (!d.websiteEvent) { setError("no_data"); return; }
        const dim = getMapDim(d.websiteEvent.map_bounds);
        dimRef.current = dim;
        setMapData(d.websiteEvent);
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

  // ── Non-passive event listeners (touchmove + wheel) ───────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !mapData) return;

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

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("wheel", onWheel);
    };
  }, [mapData]);

  // ── React event handlers (passive) ────────────────────────────────────────

  function onTouchStart(e) {
    setSignTooltip(null);
    if (e.touches.length === 1) {
      dragRef.current = { on: true, lx: e.touches[0].clientX, ly: e.touches[0].clientY, sx: e.touches[0].clientX, sy: e.touches[0].clientY, moved: false };
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
    } else if (e.touches.length === 1) {
      pinchRef.current.on = false;
      dragRef.current = { on: true, lx: e.touches[0].clientX, ly: e.touches[0].clientY, sx: e.touches[0].clientX, sy: e.touches[0].clientY, moved: false };
    }
  }

  function onPointerDown(e) {
    if (e.pointerType === "touch") return;
    dragRef.current = { on: true, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    setSignTooltip(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (e.pointerType === "touch" || !dragRef.current.on) return;
    const dx = e.clientX - dragRef.current.lx;
    const dy = e.clientY - dragRef.current.ly;
    dragRef.current.lx = e.clientX;
    dragRef.current.ly = e.clientY;
    if (Math.hypot(e.clientX - dragRef.current.sx, e.clientY - dragRef.current.sy) > DRAG_THRESHOLD) dragRef.current.moved = true;
    const { x, y, scale } = tRef.current;
    const c = clampPan(x + dx, y + dy, scale);
    applyT(c.x, c.y, scale);
  }

  function onPointerUp(e) {
    if (e.pointerType === "touch") return;
    dragRef.current.on = false;
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

  // ── Booth groups (merged companies share multiple adjacent polygons) ─────────

  const hallGroups = useMemo(() => {
    if (!mapData) return [];
    return (mapData.halls ?? []).map((hall) => ({
      ...hall,
      groups: buildBoothGroups(hall.booths ?? []),
    }));
  }, [mapData]);

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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={() => { setSelectedBooth(null); setSignTooltip(null); }}
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
              willChange: "transform",
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
              {/* Hall boundary fills */}
              {(mapData.halls ?? []).map((hall) => {
                const pts = toPoints(hall.map_bounds);
                if (!pts) return null;
                return (
                  <polygon
                    key={`h-${hall.id}`}
                    points={pts}
                    fill={`${hall.color}14`}
                    stroke={hall.color}
                    strokeWidth={4}
                    strokeOpacity={0.3}
                    style={{ pointerEvents: "none" }}
                  />
                );
              })}

              {/* Hall name watermarks — large faint text behind all booth polygons */}
              {(mapData.halls ?? []).map((hall) => {
                const c = polyCenter(hall.map_bounds);
                if (!c) return null;
                const pts = hall.map_bounds;
                if (!Array.isArray(pts) || !pts.length) return null;
                const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
                const hw = Math.max(...xs) - Math.min(...xs);
                const hh = Math.max(...ys) - Math.min(...ys);
                const fs = Math.min(hw, hh) * 0.38;
                return (
                  <text
                    key={`hl-${hall.id}`}
                    x={c.cx}
                    y={c.cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={fs}
                    fontWeight="900"
                    fill={hall.color || "#ffffff"}
                    fillOpacity={0.18}
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
                  return group.booths.map((booth) => {
                    const pts = toPoints(booth.bounds);
                    if (!pts) return null;
                    return (
                      <polygon
                        key={`b-${booth.id}`}
                        points={pts}
                        fill={
                          active
                            ? `${hall.color}cc`
                            : !isVacant
                            ? `${hall.color}60`
                            : "rgba(255,255,255,0.04)"
                        }
                        stroke={
                          isMerged && !active
                            ? "none"
                            : active
                            ? hall.color
                            : !isVacant
                            ? `${hall.color}99`
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

          </>
        )}
      </div>

      {/* ── Sign tooltip (above BottomNav) ── */}
      {signTooltip && (
        <SignTooltip sign={signTooltip.sign} sx={signTooltip.sx} sy={signTooltip.sy} lang={lang} />
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

      <BottomNav />
    </div>
  );
}
