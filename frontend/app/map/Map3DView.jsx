"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { groupOuterLoops, insetPolygonLoop } from "./mapUtils.js";

// ── Constants ──────────────────────────────────────────────────────────────────
const BOOTH_H   = 22;   // height of each extruded booth block (map units)
const FLOOR_GAP = 200;  // vertical separation between floors (map units)
const ROUTE_Y   = 5;    // route tube sits this far above floor level
// Inward offset applied to each company group's merged outer polygon (map units
// per side).  Creates a visible gap between DIFFERENT companies' 3D blocks while
// booths within the same company's merged block remain seamlessly joined.
// Total gap between two adjacent company blocks ≈ 2 × BOOTH_GAP (~8 units).
const BOOTH_GAP = 4;

// ── First-person walkthrough constants ────────────────────────────────────────
const EYE_H        = 14;   // camera height above floor during walkthrough (≈1.9m at 15 units/m scale)
const WALK_SPEED       = 75;   // map units per second (≈5 m/s — snappy but not disorienting)
const STAIR_TARGET_DUR = 0.8;  // seconds — stair transition always takes this long regardless of arc length
const LOOK_AHEAD   = 35;   // units ahead on path for near look-at sample
const LOOK_LAG     = 2.5;  // look-direction lerp rate per second (reduced from 3.0 for smoother turns)
// Destination arrival retreat — camera backs up along reverse approach direction
const RETREAT_DIST   = 220; // horizontal units to pull back from the final waypoint
const RETREAT_H_GAIN = 90;  // additional height gain during retreat (frames booth from above-eye level)
const RETREAT_DUR    = 1.8; // seconds for the retreat ease-out animation
// Drone-follow camera — matches retreat values so mid-walkthrough framing is identical
// to the arrival framing: arrival becomes a seamless continuation, not a zoom-out jump.
const DRONE_DIST = RETREAT_DIST;   // horizontal follow distance behind walker (220)
const DRONE_H    = RETREAT_H_GAIN; // height above walker's eye level (90)

// ── Module-level helpers (no hooks) ───────────────────────────────────────────

function hallToPointsArray(bounds) {
  if (!Array.isArray(bounds) || bounds.length < 2) return [];
  if (bounds.length === 2) {
    const [a, b] = bounds;
    return [
      { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
      { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) },
      { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
      { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) },
    ];
  }
  const cx = bounds.reduce((s, p) => s + p.x, 0) / bounds.length;
  const cy = bounds.reduce((s, p) => s + p.y, 0) / bounds.length;
  return [...bounds].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
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

function getHallColor(hall, hallColors, resolvedAccentColor) {
  return hallColors[hall.name] || hall.color || resolvedAccentColor || "#00ffb3";
}

// Zone fill when its hall_name has no entry in hallColors -- see the same
// constant in MapClient.jsx for the full explanation. Kept identical across
// both renderers so the 2D and 3D maps never disagree on what "unconfigured"
// looks like.
const UNCONFIGURED_ZONE_COLOR = "#ff00ff";

function parseColor(c) {
  if (!c) return new THREE.Color(0x00ffb3);
  try { return new THREE.Color(c); } catch { return new THREE.Color(0x888888); }
}

function getHighlightColor(hexStr) {
  const c = parseColor(hexStr);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // Significantly brighten: clamp to [0.65, 0.88] lightness range
  hsl.l = Math.min(0.88, Math.max(0.65, hsl.l + 0.30));
  return c.setHSL(hsl.h, hsl.s, hsl.l);
}

const MARKER_SIZE = 48; // world-unit size for route start/end/stairs sprites

function makeEmojiTexture(emoji) {
  const SIZE = 80;
  const canvas = document.createElement("canvas");
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  ctx.font         = `${Math.round(SIZE * 0.70)}px serif`;
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor  = "rgba(0,0,0,0.85)";
  ctx.shadowBlur   = 6;
  ctx.fillText(emoji, SIZE / 2, SIZE / 2);
  return new THREE.CanvasTexture(canvas);
}

// Returns a Promise<THREE.Texture> for an uploaded image path
function makeUploadTexture(url) {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(url, resolve, undefined, () => resolve(makeEmojiTexture("📍")));
  });
}

// Renders a text string to a canvas-backed sprite texture.
// Returns { tex: THREE.CanvasTexture, w: canvasWidth, h: canvasHeight }.
// dir: 'ltr' | 'rtl' — controls canvas text direction attribute.
const _LABEL_FONT_SIZE = 22;
const _LABEL_PAD_X     = 13;
const _LABEL_PAD_Y     = 7;
const _LABEL_MAX_TEXT_W = 260; // px — truncate beyond this width
// Reuse a single probe canvas for all text measurements instead of creating one per label
// (avoids creating ~700 throw-away canvas elements that briefly spike GPU/CPU memory at mount)
let _probeCanvas = null;
let _probeCtx    = null;

function makeTextLabelTexture(text, dir = 'ltr') {
  if (!_probeCanvas) {
    _probeCanvas = document.createElement('canvas');
    _probeCanvas.width = 512; _probeCanvas.height = 1;
    _probeCtx = _probeCanvas.getContext('2d');
  }
  const pCtx = _probeCtx;
  pCtx.font = `500 ${_LABEL_FONT_SIZE}px Vazirmatn, Tahoma, Arial, sans-serif`;

  let display = text;
  let textW = pCtx.measureText(display).width;
  if (textW > _LABEL_MAX_TEXT_W) {
    let lo = 1, hi = text.length - 1, best = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pCtx.measureText(text.slice(0, mid) + '…').width <= _LABEL_MAX_TEXT_W) {
        best = mid; lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    display = text.slice(0, best) + '…';
    textW = pCtx.measureText(display).width;
  }

  const W = Math.ceil(textW) + _LABEL_PAD_X * 2;
  const H = _LABEL_FONT_SIZE + _LABEL_PAD_Y * 2;
  const r = H / 2; // pill radius

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Pill-shaped semi-transparent background
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(W - r, 0);
  ctx.arcTo(W, 0, W, r, r);
  ctx.lineTo(W, H - r);
  ctx.arcTo(W, H, W - r, H, r);
  ctx.lineTo(r, H);
  ctx.arcTo(0, H, 0, H - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fill();

  // White text with subtle drop shadow
  ctx.font      = `500 ${_LABEL_FONT_SIZE}px Vazirmatn, Tahoma, Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  if ('direction' in ctx) ctx.direction = dir;
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur  = 4;
  ctx.fillText(display, W / 2, H / 2);

  return { tex: new THREE.CanvasTexture(canvas), w: W, h: H };
}

// ── Map3DView component ────────────────────────────────────────────────────────
// Coordinate mapping: map (x, y) → Three.js world (x, floorY, y).
// Y axis is vertical/up; XZ plane is the floor.

export default function Map3DView({
  halls,                // hallGroups from MapClient (includes .floor, .groups)
  hallColors,           // { [hallName]: hexColor }
  hallFloors,           // { [hallName]: floorNumber } — same lookup used by pathfinding
  zones,                // named map_zones (title_fa truthy) to render as 3D blocks
  navRoute,             // null | { type, path?, pathA?, pathB?, stairsFrom?, stairsTo? }
  navStart,             // null | { x, y, floor }
  navDest,              // null | { x, y, floor }
  navCameraConfig,      // { distance, height } — drone/walkthrough camera settings from DB
  navMarkerIcons,       // { route_start, route_end, … } — icon config from DB
  idleCameraConfig,     // { default_camera: { pitch, distance, heading } } — idle overview camera from DB
  bgColor,              // string hex — map background color (theme-specific, from DB)
  routeColors,          // { routeLine, routeArrow, walkthroughHalo, walkthroughStripe } — primary (same-floor) colors
  routeColorsSecondary, // same shape — cross-floor/destination-floor colors (pathB in multi_floor routes)
  resolvedAccentColor,  // live --accent hex, resolved by MapClient via getComputedStyle (Three.js can't read
                         // CSS custom properties itself) — last-resort fallback when a hall/route has no
                         // admin-configured color at all
  tapStartMode,         // bool — next tap sets route start
  onBoothTap,           // (booth, hall, { cx, cy, mergedLabel }) → void
  onZoneTap,            // (zone, { cx, cy }) → void
  onGroundTap,          // (mapX, mapY) → void  — tap on empty ground in tapStartMode
  onBackgroundTap,      // () → void — tap on empty space (close sheets)
  controlRef,           // ref whose .current receives { focusOnPoint, resetView, zoom }
  selectedBoothId,      // company id of currently selected booth (or null)
  selectedZoneId,       // zone.id of currently selected zone (or null)
  onReady,              // () => void — fires synchronously at end of scene-setup effect
  onGestureStart,       // () => void — fires when OrbitControls begins a gesture (RULE 4: suppress backdrop-filter)
  onGestureEnd,         // () => void — fires when OrbitControls gesture ends
  lang = 'fa',          // 'fa' | 'en' — controls booth label language
  boothLabelThreshold,  // number (map units) — camera XZ distance below which labels appear
}) {
  const mountRef = useRef(null);
  const tRef     = useRef(null); // holds all Three.js state (scene, camera, …)
  // Keep callbacks fresh without recreating the scene
  const cbRef    = useRef({ onBoothTap, onZoneTap, tapStartMode, onGroundTap, onBackgroundTap });
  useEffect(() => {
    cbRef.current = { onBoothTap, onZoneTap, tapStartMode, onGroundTap, onBackgroundTap };
  }, [onBoothTap, onZoneTap, tapStartMode, onGroundTap, onBackgroundTap]);
  // Track lang in a ref so the scene-setup effect (which runs once) can read initial value
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);

  // ── Scene setup (runs once on mount, halls is populated before mount) ────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const t = {};
    tRef.current = t;
    // Camera distance/height for drone follow — read from DB config, default to module constants
    t.camDist = navCameraConfig?.distance ?? DRONE_DIST;
    t.camH    = navCameraConfig?.height   ?? DRONE_H;

    const W = el.clientWidth  || window.innerWidth;
    const H = el.clientHeight || window.innerHeight;

    // Scene
    t.scene = new THREE.Scene();
    try { t.scene.background = new THREE.Color(bgColor ?? '#021f20'); }
    catch { t.scene.background = new THREE.Color(0x021f20); }

    // Camera
    t.camera = new THREE.PerspectiveCamera(48, W / H, 1, 40000);

    // WebGL renderer — full quality always: Map3DView is a conditional render
    // ({view3D && <Map3DView/>}) so it fully unmounts (WebGL context destroyed,
    // all resources freed) the moment the user switches to 2D.  There is no
    // "running in background" scenario that would justify quality reductions.
    t.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    t.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    t.renderer.setSize(W, H);
    el.appendChild(t.renderer.domElement);

    // Diagnostic: fired by iOS Safari under GPU memory pressure, often as a precursor
    // to killing the tab.  preventDefault() signals we want context restoration.
    // Named (not inline) so cleanup below can remove them like the other listeners.
    function onContextLost(e) {
      e.preventDefault();
      console.warn('[Map3D] webglcontextlost — GPU memory pressure');
    }
    function onContextRestored() {
      console.warn('[Map3D] webglcontextrestored');
    }
    t.renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);
    t.renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false);

    // Lighting
    t.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(500, 900, 400);
    t.scene.add(sun);

    // OrbitControls
    t.controls = new OrbitControls(t.camera, t.renderer.domElement);
    t.controls.enableDamping = true;
    t.controls.dampingFactor   = 0.08;
    t.controls.minPolarAngle   = Math.PI / 10;    // ~18° from top
    t.controls.maxPolarAngle   = Math.PI * 0.46;  // ~83° from top
    t.controls.minDistance     = 40;
    t.controls.maxDistance     = 10000;
    t.controls.panSpeed        = 0.7;
    t.controls.rotateSpeed     = 0.5;
    t.controls.zoomSpeed       = 1.0;
    // Google Maps touch convention: 1-finger → pan, 2-finger → rotate + pinch-zoom
    t.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    // Always pan on the horizontal world plane regardless of camera pitch.
    // With screenSpacePanning=true (default), vertical drags move along camera-local Y,
    // which at shallow pitch angles points partly upward in world space — causing the
    // view to lift instead of translate, making pan feel angle-dependent and sluggish.
    // false → _panUp uses (cameraRight × worldUp), always a horizontal XZ vector.
    t.controls.screenSpacePanning = false;

    // RULE 4 (3D mode): suppress backdrop-filter on all overlays during OrbitControls
    // gestures — same mechanism as the 2D gesture fix.  OrbitControls emits 'start'
    // when the first pointer touches down and 'end' when all pointers lift.
    // MapClient adds/removes 'map-gesture-active' on pageRootRef, which triggers the
    // globals.css rule { backdrop-filter: none !important } on every descendant.
    t.controls.addEventListener('start', () => { onGestureStart?.(); });
    t.controls.addEventListener('end',   () => { onGestureEnd?.();   });

    t.raycaster   = new THREE.Raycaster();
    t.boothEntries = []; // { mesh, booth, hall, mergedLabel, cx, cz, colorStr }
    t.zoneEntries  = []; // { mesh, zone, cx, cz, colorStr }
    t.zoneLabelEntries = []; // { sprite, mat, texFa, texEn, scaleFa, scaleEn, cx, cz }
    t.disposables  = []; // { geometry?, material? } — disposed on unmount
    t.routeObjects   = [];
    t.routeTextures  = [];
    t.clock          = new THREE.Clock();

    // ── Build booths ──────────────────────────────────────────────────────────
    // One ExtrudeGeometry per company group — booths belonging to the same company
    // are merged into a single seamless 3D block using groupOuterLoops() (the same
    // algorithm that drives the 2D SVG outer-boundary strokes).  An inward polygon
    // offset (insetPolygonLoop) is applied to the merged outer boundary before
    // extrusion so adjacent COMPANY groups are visually separated, while individual
    // booths within a company appear as one continuous block with no internal seams.
    //
    // Raycasting: each merged mesh stores group.booths[0] as the representative
    // booth; the selection highlight then filters boothEntries by company?.id so
    // all meshes belonging to the same company highlight together.
    //
    // Isolation: booth.bounds data is never mutated; pathfinding and 2D rendering
    // are completely unaffected.

    const allXs = [], allZs = [];
    for (const hall of halls) {
      const floorY   = (hall.floor ?? 0) * FLOOR_GAP;
      const colorStr = getHallColor(hall, hallColors, resolvedAccentColor);

      for (const group of (hall.groups ?? [])) {
        if (!group.booths.length) continue;
        const mergedLabel = boothRangeLabel(group.booths.map((b) => b.no));
        const firstBooth  = group.booths[0];

        // Bounding box of all booths in the group (for camera centering)
        const allGroupPts = group.booths.flatMap((b) => b.bounds ?? []);
        if (!allGroupPts.length) continue;
        const gxs = allGroupPts.map((p) => p.x), gzs = allGroupPts.map((p) => p.y);
        const gx0 = Math.min(...gxs), gx1 = Math.max(...gxs);
        const gz0 = Math.min(...gzs), gz1 = Math.max(...gzs);
        const cx  = (gx0 + gx1) / 2,  cz = (gz0 + gz1) / 2;
        allXs.push(gx0, gx1); allZs.push(gz0, gz1);

        const loops = groupOuterLoops(group.booths);

        if (loops.length > 0) {
          // Normal path: extrude the inset merged outer polygon
          for (const rawLoop of loops) {
            if (rawLoop.length < 3) continue;
            const loop = insetPolygonLoop(rawLoop, BOOTH_GAP);
            if (!loop || loop.length < 3) continue;

            // THREE.Shape is defined in the XY plane.  Map Y increases downward,
            // Three.js Y is up — negate Y here; geo.rotateX(-π/2) maps the shape's
            // Z axis onto the world's -Y axis, placing the shape flat on the floor.
            const shape = new THREE.Shape(loop.map((p) => new THREE.Vector2(p.x, -p.y)));
            const geo   = new THREE.ExtrudeGeometry(shape, { depth: BOOTH_H, bevelEnabled: false });
            geo.rotateX(-Math.PI / 2);
            const mat  = new THREE.MeshLambertMaterial({ color: parseColor(colorStr) });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.y = floorY;
            t.scene.add(mesh);
            t.disposables.push({ geometry: geo, material: mat });
            t.boothEntries.push({ mesh, booth: firstBooth, hall, mergedLabel, cx, cz, colorStr });
          }
        } else {
          // Fallback: degenerate group data — render per-booth boxes with gap
          for (const booth of group.booths) {
            const pts = hallToPointsArray(booth.bounds);
            if (pts.length < 3) continue;
            const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
            const x0 = Math.min(...xs), x1 = Math.max(...xs);
            const y0 = Math.min(...ys), y1 = Math.max(...ys);
            const bw  = Math.max(x1 - x0 - BOOTH_GAP * 2, 1);
            const bd  = Math.max(y1 - y0 - BOOTH_GAP * 2, 1);
            const bcx = (x0 + x1) / 2, bcz = (y0 + y1) / 2;
            const geo  = new THREE.BoxGeometry(bw, BOOTH_H, bd);
            const mat  = new THREE.MeshLambertMaterial({ color: parseColor(colorStr) });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(bcx, floorY + BOOTH_H / 2, bcz);
            t.scene.add(mesh);
            t.disposables.push({ geometry: geo, material: mat });
            t.boothEntries.push({ mesh, booth: firstBooth, hall, mergedLabel, cx, cz, colorStr });
          }
        }
      }
    }

    // ── Build named zones — same height as booths for visual consistency ─────
    for (const zone of (zones ?? [])) {
      const colorStr = hallColors[zone.hall_name] || UNCONFIGURED_ZONE_COLOR;
      const shape = zone.shape_type || "rectangle";
      let cx, cz, bw, bd;
      if (shape === "circle") {
        cx = zone.cx ?? 0; cz = zone.cy ?? 0;
        bw = bd = Math.max((zone.radius ?? 50) * 2, 1);
      } else if (shape === "polygon" && Array.isArray(zone.points) && zone.points.length >= 3) {
        const xs = zone.points.map((p) => p.x), ys = zone.points.map((p) => p.y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs);
        const y0 = Math.min(...ys), y1 = Math.max(...ys);
        cx = (x0 + x1) / 2; cz = (y0 + y1) / 2;
        bw = Math.max(x1 - x0, 1); bd = Math.max(y1 - y0, 1);
      } else {
        const x1 = zone.x1 ?? 0, x2 = zone.x2 ?? 0;
        const y1 = zone.y1 ?? 0, y2 = zone.y2 ?? 0;
        cx = (x1 + x2) / 2; cz = (y1 + y2) / 2;
        bw = Math.max(Math.abs(x2 - x1), 1); bd = Math.max(Math.abs(y2 - y1), 1);
      }
      const zoneFloorY = ((hallFloors ?? {})[zone.hall_name] ?? 0) * FLOOR_GAP;
      const geo = new THREE.BoxGeometry(bw, BOOTH_H, bd);
      const mat = new THREE.MeshLambertMaterial({ color: parseColor(colorStr) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, zoneFloorY + BOOTH_H / 2, cz);
      t.scene.add(mesh);
      t.disposables.push({ geometry: geo, material: mat });
      t.zoneEntries.push({ mesh, zone, cx, cz, colorStr });

      // ── Zone name label sprite (same pill style as booth labels) ────────────
      // Texture creation is deferred to first enter-range in the RAF loop to avoid
      // GPU-uploading all zone textures at mount.
      const titleFa = (zone.title_fa ?? '').trim();
      const titleEn = (zone.title_en ?? '').trim();
      if (titleFa || titleEn) {
        const ZL_H = 20; // world-unit sprite height — matches booth label scale
        const zMat    = new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true });
        const zSprite = new THREE.Sprite(zMat);
        zSprite.position.set(cx, zoneFloorY + BOOTH_H + 10, cz);
        zSprite.scale.set(ZL_H, ZL_H, 1); // placeholder until first-time texture loads
        zSprite.visible = false;
        t.scene.add(zSprite);
        t.zoneLabelEntries.push({
          sprite: zSprite, mat: zMat,
          titleFa, titleEn, ZL_H,
          texFa: null, texEn: null,
          scaleFa: null, scaleEn: null,
          cx, cz,
          texLoaded: false,
        });
      }
    }

    // ── Booth name label sprites ──────────────────────────────────────────────
    // One sprite per company (deduped). Textures are deferred — created on first
    // enter-range in the RAF loop to avoid GPU-uploading all ~650 textures at mount.
    t.labelEntries = []; // { sprite, mat, nameFa, nameEn, texFa, texEn, scaleFa, scaleEn, cx, cz, texLoaded }
    t.boothLabelThreshSq = 0; // set by boothLabelThreshold prop effect below
    const LABEL_H_WU = 20; // sprite height in world units
    const labeledCos = new Set();
    for (const entry of t.boothEntries) {
      const co = entry.booth.company;
      if (!co?.id) continue;
      if (labeledCos.has(co.id)) continue;
      labeledCos.add(co.id);

      const nameFa = (co.brand_name_fa ?? '').trim();
      const nameEn = (co.brand_name_en ?? '').trim();
      if (!nameFa && !nameEn) continue;

      // Sprite with no map yet — texture allocated on first enter-range
      const mat    = new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true });
      const sprite = new THREE.Sprite(mat);
      const floorY = (entry.hall.floor ?? 0) * FLOOR_GAP;
      sprite.position.set(entry.cx, floorY + BOOTH_H + 10, entry.cz);
      sprite.scale.set(LABEL_H_WU, LABEL_H_WU, 1); // placeholder until first-time texture loads
      sprite.visible = false;
      t.scene.add(sprite);

      t.labelEntries.push({
        sprite, mat,
        nameFa, nameEn, LABEL_H_WU,
        texFa: null, texEn: null,
        scaleFa: null, scaleEn: null,
        cx: entry.cx, cz: entry.cz,
        texLoaded: false,
      });
    }

    // ── Camera initial position ───────────────────────────────────────────────
    // idleCameraConfig controls the overview/idle framing (distinct from the
    // walkthrough drone camera which uses navCameraConfig / t.camDist / t.camH).
    //
    // pitch:   elevation angle in degrees (higher → more aerial/top-down).
    // distance: multiplier on the map-span-based base distance.
    // heading: compass bearing (0°=north, 90°=east, 180°=south, 270°=west) of
    //          where the camera sits relative to the orbit target.
    //          Default 86° = camera placed almost due east (near Hall E entrance)
    //          looking almost due west toward Hall A.
    //
    //          Derivation: Hall E entrance Three.js (5275, 0, 1239) vs map
    //          center (2786, 0, 1405) → ΔX=+2489, ΔZ=-166 → bearing ≈ 86°.
    if (allXs.length && allZs.length) {
      const minX = Math.min(...allXs), maxX = Math.max(...allXs);
      const minZ = Math.min(...allZs), maxZ = Math.max(...allZs);
      const scX  = (minX + maxX) / 2, scZ = (minZ + maxZ) / 2;
      const span = Math.max(maxX - minX, maxZ - minZ);
      const pitchDeg   = idleCameraConfig?.default_camera?.pitch    ?? 50;
      const distFactor = idleCameraConfig?.default_camera?.distance ?? 1.0;
      const headingDeg = idleCameraConfig?.default_camera?.heading  ?? 86;
      const dist       = span * 0.85 * distFactor;
      const pitchRad   = pitchDeg   * Math.PI / 180;
      const headingRad = headingDeg * Math.PI / 180;
      // Compass: camera offset from target = (sin(h)*d, tan(p)*d, -cos(h)*d)
      t.controls.target.set(scX, 0, scZ);
      t.camera.position.set(
        scX + Math.sin(headingRad) * dist,
        dist * Math.tan(pitchRad),
        scZ - Math.cos(headingRad) * dist,
      );
      t.controls.update();
      t.defaultCamPos  = t.camera.position.clone();
      t.defaultTarget  = t.controls.target.clone();
    }

    // Ground plane — used for tapStartMode hit-testing
    t.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // ── Click / tap handler (native, on canvas) ───────────────────────────────
    let ptrStart = { x: 0, y: 0 };
    function onPtrDown(e) { ptrStart = { x: e.clientX, y: e.clientY }; }
    function onClick(e) {
      // Always stop propagation so React container's onClick doesn't also fire
      e.stopPropagation();
      if (Math.hypot(e.clientX - ptrStart.x, e.clientY - ptrStart.y) > 6) return;
      const rect = el.getBoundingClientRect();
      const ndc = {
        x:  ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        y: -((e.clientY - rect.top)  / rect.height)  * 2 + 1,
      };
      t.raycaster.setFromCamera(ndc, t.camera);

      // Booth hit
      const hits = t.raycaster.intersectObjects(t.boothEntries.map((b) => b.mesh), false);
      if (hits.length) {
        const entry = t.boothEntries.find((b) => b.mesh === hits[0].object);
        if (entry) {
          cbRef.current.onBoothTap(
            entry.booth, entry.hall,
            { cx: entry.cx, cy: entry.cz, mergedLabel: entry.mergedLabel }
          );
          return;
        }
      }

      // Zone hit
      const zoneHits = t.raycaster.intersectObjects(t.zoneEntries.map((z) => z.mesh), false);
      if (zoneHits.length) {
        const entry = t.zoneEntries.find((z) => z.mesh === zoneHits[0].object);
        if (entry) {
          cbRef.current.onZoneTap?.(entry.zone, { cx: entry.cx, cy: entry.cz });
          return;
        }
      }

      // Ground tap
      if (cbRef.current.tapStartMode) {
        const pt = new THREE.Vector3();
        if (t.raycaster.ray.intersectPlane(t.groundPlane, pt)) {
          cbRef.current.onGroundTap(pt.x, pt.z);
        }
        return;
      }

      // Background tap — dismiss sheets / search
      cbRef.current.onBackgroundTap?.();
    }
    t.renderer.domElement.addEventListener("pointerdown", onPtrDown);
    t.renderer.domElement.addEventListener("click", onClick);

    // ── Expose imperative API via controlRef ──────────────────────────────────
    if (controlRef) {
      controlRef.current = {
        focusOnPoint(mx, mz) {
          t.tween = {
            startTarget:  t.controls.target.clone(),
            endTarget:    new THREE.Vector3(mx, 0, mz),
            startCamPos:  t.camera.position.clone(),
            // Zoom in to ~40% of current distance while re-centering
            endCamPos:    (() => {
              const offset = t.camera.position.clone().sub(t.controls.target);
              return new THREE.Vector3(mx, 0, mz).add(offset.multiplyScalar(0.4));
            })(),
            t0: performance.now(), dur: 600,
          };
        },
        resetView() {
          if (!t.defaultCamPos) return;
          t.tween = {
            startTarget: t.controls.target.clone(),
            endTarget:   t.defaultTarget.clone(),
            startCamPos: t.camera.position.clone(),
            endCamPos:   t.defaultCamPos.clone(),
            t0: performance.now(), dur: 700,
          };
        },
        zoom(factor) {
          const dir  = new THREE.Vector3().subVectors(t.camera.position, t.controls.target).normalize();
          const dist = t.camera.position.distanceTo(t.controls.target);
          const nd   = Math.max(t.controls.minDistance, Math.min(t.controls.maxDistance, dist / factor));
          t.camera.position.copy(t.controls.target).addScaledVector(dir, nd);
          t.controls.update();
        },

        // First-person walkthrough: animate camera along the pre-built walkthroughPath.
        // Returns true if the walkthrough started successfully, false if no path is available.
        startWalkthrough(onComplete) {
          if (!t.walkthroughPath || t.walkthroughPath.length < 2) return false;
          if (t.walk) { t.walk = null; }
          // Piecewise-linear CurvePath so the walkthrough camera follows the exact
          // A* route without cutting booth corners (same reason as addRouteTube above).
          const curve = new THREE.CurvePath();
          const wpts  = t.walkthroughPath;
          for (let i = 0; i < wpts.length - 1; i++) curve.add(new THREE.LineCurve3(wpts[i], wpts[i + 1]));
          const curveLen = curve.getLength();
          if (curveLen < 1) return false;
          // Precompute cumulative arc-length to each waypoint for discrete step-forward/back
          const wptArcLengths = [0];
          for (let i = 1; i < wpts.length; i++)
            wptArcLengths.push(wptArcLengths[i - 1] + wpts[i - 1].distanceTo(wpts[i]));
          // Resolve stair arc-length range from the waypoint-index range stored during
          // route building.  Both are -1 when there is no stair segment (single-floor routes).
          const _sr = t.walkthroughStairRange;
          const stairArcStart = (_sr && wptArcLengths[_sr.start] != null) ? wptArcLengths[_sr.start] : -1;
          const stairArcEnd   = (_sr && wptArcLengths[_sr.end]   != null) ? wptArcLengths[_sr.end]   : -1;
          // Duration-based stair speed: the stair 3D arc may be much longer than the
          // pure-vertical 200-unit estimate if stairsFrom/stairsTo have significant XZ
          // displacement.  Dividing the actual arc length by the target duration gives the
          // correct speed regardless of staircase geometry.
          const walkSpeed      = t.walkSpeed      ?? WALK_SPEED;
          const stairTargetDur = t.stairTargetDur ?? STAIR_TARGET_DUR;
          const stairSegLen = (stairArcStart >= 0 && stairArcEnd > stairArcStart)
            ? stairArcEnd - stairArcStart : 0;
          const stairSpeed  = stairSegLen > 0 ? stairSegLen / stairTargetDur : walkSpeed;
          // Cancel any in-flight overview tween and disable user orbit input
          t.tween = null;
          t.controls.enabled = false;
          // Place drone camera behind and above the path start
          const startPt  = curve.getPointAt(0);
          const lookT    = Math.min(1, LOOK_AHEAD / curveLen);
          const lookPt   = curve.getPointAt(lookT);
          const initFwd  = new THREE.Vector3(lookPt.x - startPt.x, 0, lookPt.z - startPt.z);
          if (initFwd.lengthSq() > 0.0001) initFwd.normalize(); else initFwd.set(0, 0, 1);
          t.camera.position.set(
            startPt.x - initFwd.x * t.camDist,
            startPt.y + t.camH,
            startPt.z - initFwd.z * t.camDist,
          );
          t.camera.lookAt(startPt.x, startPt.y - 3, startPt.z);
          t.walk = {
            curve,
            curveLen,
            progress:       0,
            smoothLook:     new THREE.Vector3(startPt.x, startPt.y - 3, startPt.z),
            paused:         false,
            wptArcLengths,
            stairArcStart,
            stairArcEnd,
            stairSpeed,
            walkSpeed,
            onComplete:     onComplete ?? null,
            // Reusable scratch vectors — avoids per-frame GC allocation in the RAF loop
            _pos:      new THREE.Vector3(),
            _p1:       new THREE.Vector3(),
            _p2:       new THREE.Vector3(),
            _p3:       new THREE.Vector3(),
            _ahead:    new THREE.Vector3(),
            _fwd:      new THREE.Vector3(), // scratch: per-frame forward direction compute
            _droneDir: initFwd.clone(), // smoothed XZ forward direction for drone camera offset
            // Retreat phase (populated when tParam reaches 1.0)
            retreating:      false,
            retreatFrom:     null,
            retreatTo:       null,
            retreatLook:     null,
            retreatProgress: 0,
          };
          return true;
        },

        // Stop the walkthrough early (also works during the retreat phase).
        // Leaves the camera at its current position and re-enables OrbitControls.
        stopWalkthrough() {
          if (!t.walk) return;
          const ws = t.walk;
          // During retreat, prefer the retreat look target so orbit stays on the booth
          const orbitTarget = (ws.retreating && ws.retreatLook)
            ? ws.retreatLook.clone()
            : ws.smoothLook.clone();
          t.walk = null;
          t.controls.enabled = true;
          t.controls.target.copy(orbitTarget);
        },

        pauseWalkthrough()  { if (t.walk) t.walk.paused = true;  },
        resumeWalkthrough() { if (t.walk) t.walk.paused = false; },

        // Discrete step: jump camera to previous/next waypoint along the route.
        // Works regardless of paused state — if playing, animation resumes from
        // the new position; if paused, camera stays frozen at the new waypoint.
        stepForward() {
          if (!t.walk) return;
          const ws = t.walk;
          // If user steps forward during the retreat, cancel retreat and resume from end
          ws.retreating = false;
          const nextAL = ws.wptArcLengths.find(al => al > ws.progress + 0.5);
          ws.progress  = nextAL !== undefined ? Math.min(nextAL, ws.curveLen) : ws.curveLen;
          const tParam = ws.progress / ws.curveLen;
          const pos    = ws.curve.getPointAt(tParam, ws._pos);
          const lookT  = Math.min(1.0, (ws.progress + LOOK_AHEAD) / ws.curveLen);
          ws.curve.getPointAt(lookT, ws._ahead);
          // Snap drone direction to current path direction
          const sfFwd = new THREE.Vector3(ws._ahead.x - pos.x, 0, ws._ahead.z - pos.z);
          if (sfFwd.lengthSq() > 0.0001) { sfFwd.normalize(); ws._droneDir.copy(sfFwd); }
          t.camera.position.set(
            pos.x - ws._droneDir.x * t.camDist,
            pos.y + t.camH,
            pos.z - ws._droneDir.z * t.camDist,
          );
          ws.smoothLook.set(pos.x, pos.y - 3, pos.z);
          t.camera.lookAt(ws.smoothLook);
        },
        stepBack() {
          if (!t.walk) return;
          const ws = t.walk;
          // Stepping back always cancels the retreat phase
          ws.retreating = false;
          let prevAL = 0;
          for (let i = ws.wptArcLengths.length - 1; i >= 0; i--) {
            if (ws.wptArcLengths[i] < ws.progress - 0.5) { prevAL = ws.wptArcLengths[i]; break; }
          }
          ws.progress  = prevAL;
          const tParam = ws.progress / ws.curveLen;
          const pos    = ws.curve.getPointAt(tParam, ws._pos);
          const lookT  = Math.min(1.0, (ws.progress + LOOK_AHEAD) / ws.curveLen);
          ws.curve.getPointAt(lookT, ws._ahead);
          // Snap drone direction to current path direction
          const sbFwd = new THREE.Vector3(ws._ahead.x - pos.x, 0, ws._ahead.z - pos.z);
          if (sbFwd.lengthSq() > 0.0001) { sbFwd.normalize(); ws._droneDir.copy(sbFwd); }
          t.camera.position.set(
            pos.x - ws._droneDir.x * t.camDist,
            pos.y + t.camH,
            pos.z - ws._droneDir.z * t.camDist,
          );
          ws.smoothLook.set(pos.x, pos.y - 3, pos.z);
          t.camera.lookAt(ws.smoothLook);
        },
      };
    }

    // ── RAF loop ──────────────────────────────────────────────────────────────
    function animate() {
      t.animId = requestAnimationFrame(animate);
      // Skip rendering when tab is backgrounded — iOS kills backgrounded WebGL contexts
      // under memory pressure; stopping the RAF prevents unnecessary GPU work.
      if (document.hidden) return;
      const delta = t.clock.getDelta();

      // Animate route flow textures (scroll UV offset toward destination)
      if (t.routeTextures.length) {
        for (const tex of t.routeTextures) tex.offset.x -= delta * 0.35;
      }

      // Camera tween (skip during first-person walkthrough)
      if (!t.walk && t.tween) {
        const p = Math.min(1, (performance.now() - t.tween.t0) / t.tween.dur);
        const e = 1 - (1 - p) ** 3; // cubic ease-out
        t.controls.target.lerpVectors(t.tween.startTarget, t.tween.endTarget, e);
        if (t.tween.startCamPos) t.camera.position.lerpVectors(t.tween.startCamPos, t.tween.endCamPos, e);
        if (p >= 1) t.tween = null;
      }

      // ── First-person walkthrough ─────────────────────────────────────────────
      // Drives camera position + orientation along the pre-built walkthroughPath
      // using only refs + direct Three.js calls — no React state per frame.
      if (t.walk) {
        const ws = t.walk;

        // ── Retreat phase: eased backward pull after reaching the destination ──
        // Triggered when the camera would otherwise clip into the booth geometry.
        if (ws.retreating) {
          if (!ws.paused) {
            ws.retreatProgress = Math.min(1, ws.retreatProgress + delta / RETREAT_DUR);
          }
          // Cubic ease-out — fast start, gentle deceleration into final framing
          const e = 1 - (1 - ws.retreatProgress) ** 3;
          t.camera.position.lerpVectors(ws.retreatFrom, ws.retreatTo, e);
          // Smoothly rotate camera to face the booth during retreat
          ws.smoothLook.lerp(ws.retreatLook, Math.min(1, delta * 2.5));
          t.camera.lookAt(ws.smoothLook);

          if (ws.retreatProgress >= 1.0) {
            const cb = ws.onComplete;
            t.walk = null;
            t.controls.enabled = true;
            // Orbit target = destination booth so the user can pivot around it
            t.controls.target.copy(ws.retreatLook);
            if (cb) cb();
          }

        } else {
          // ── Normal path-following (drone camera) ─────────────────────────
          if (!ws.paused) {
            const inStair = ws.stairArcStart >= 0
              && ws.progress >= ws.stairArcStart
              && ws.progress <  ws.stairArcEnd;
            // ws.stairSpeed = stairArcLen / stairTargetDur, so the transition always takes the
            // configured target duration regardless of stairsFrom/stairsTo XZ displacement.
            ws.progress = Math.min(
              ws.progress + delta * (inStair ? ws.stairSpeed : ws.walkSpeed),
              ws.curveLen,
            );
          }
          const tParam = ws.progress / ws.curveLen;
          const pos    = ws.curve.getPointAt(tParam, ws._pos);

          // Multi-sample blended look-ahead to compute forward travel direction.
          // Three samples (near 35u / mid 70u / far 122u) weighted 50/30/20 anticipate
          // upcoming turns early so the drone camera starts rotating before the corner.
          const L1 = Math.min(1.0, (ws.progress + LOOK_AHEAD)       / ws.curveLen);
          const L2 = Math.min(1.0, (ws.progress + LOOK_AHEAD * 2.0) / ws.curveLen);
          const L3 = Math.min(1.0, (ws.progress + LOOK_AHEAD * 3.5) / ws.curveLen);
          ws.curve.getPointAt(L1, ws._p1);
          ws.curve.getPointAt(L2, ws._p2);
          ws.curve.getPointAt(L3, ws._p3);
          ws._ahead.set(
            ws._p1.x * 0.50 + ws._p2.x * 0.30 + ws._p3.x * 0.20,
            pos.y,
            ws._p1.z * 0.50 + ws._p2.z * 0.30 + ws._p3.z * 0.20,
          );
          // Smooth the forward travel direction (XZ only) — uses scratch _fwd to avoid GC
          ws._fwd.set(ws._ahead.x - pos.x, 0, ws._ahead.z - pos.z);
          if (ws._fwd.lengthSq() > 0.0001) {
            ws._fwd.normalize();
            ws._droneDir.lerp(ws._fwd, Math.min(1, delta * LOOK_LAG));
            if (ws._droneDir.lengthSq() > 0.0001) ws._droneDir.normalize();
          }
          // Drone camera: positioned behind and above the walker
          t.camera.position.set(
            pos.x - ws._droneDir.x * t.camDist,
            pos.y + t.camH,
            pos.z - ws._droneDir.z * t.camDist,
          );
          // Look at walker's current position from the drone perspective
          ws.smoothLook.set(pos.x, pos.y - 3, pos.z);
          t.camera.lookAt(ws.smoothLook);

          // At the end of the path, trigger a retreat instead of stopping in-booth.
          // Since the drone camera is already at t.camDist / t.camH, the retreat
          // starts from the current camera position — arrival is a seamless continuation.
          if (!ws.paused && tParam >= 1.0) {
            const finalPos = pos.clone(); // at the booth boundary / destination
            // Final approach vector: from the point LOOK_AHEAD before the end to the end
            const approachT    = Math.max(0, 1.0 - LOOK_AHEAD / ws.curveLen);
            const approachFrom = ws.curve.getPointAt(approachT);
            const approachDir  = new THREE.Vector3()
              .subVectors(finalPos, approachFrom)
              .setY(0)
              .normalize();
            // If path is degenerate (all waypoints at same XZ), fall back to +Z retreat
            if (approachDir.lengthSq() < 0.01) approachDir.set(0, 0, 1);
            // Retreat destination: same formula as drone camera — ensures from ≈ to
            const retreatTo = finalPos.clone()
              .addScaledVector(approachDir, -t.camDist)
              .setY(finalPos.y + t.camH);
            // Orbit / look target: booth center at comfortable mid-height
            const retreatLook = new THREE.Vector3(finalPos.x, finalPos.y - 3, finalPos.z);
            ws.retreating      = true;
            ws.retreatFrom     = t.camera.position.clone(); // start from current drone pos
            ws.retreatTo       = retreatTo;
            ws.retreatLook     = retreatLook;
            ws.retreatProgress = 0;
          }
        }
      }

      // OrbitControls update — skip during active walkthrough to avoid fighting camera
      if (!t.walk) t.controls.update();

      // Label visibility (booths + zones) — checked every 2nd frame.
      // Works for both idle (OrbitControls camera) and walkthrough (drone camera)
      // since t.camera is the single camera used in both modes.
      if (t.labelEntries?.length || t.zoneLabelEntries?.length) {
        t._lblFrame = ((t._lblFrame ?? 0) + 1);
        if (t._lblFrame % 2 === 0) {
          const thSq = t.boothLabelThreshSq ?? 0;
          const cp   = t.camera.position;
          if (thSq > 0) {
            for (const le of (t.labelEntries ?? [])) {
              const dx = cp.x - le.cx, dz = cp.z - le.cz;
              const inRange = (dx * dx + dz * dz) < thSq;
              if (inRange && !le.texLoaded) {
                // First enter-range: create and GPU-upload texture now
                const rFa = le.nameFa ? makeTextLabelTexture(le.nameFa, 'rtl') : null;
                const rEn = le.nameEn ? makeTextLabelTexture(le.nameEn, 'ltr') : null;
                const H   = le.LABEL_H_WU;
                le.texFa   = rFa?.tex ?? null;
                le.texEn   = rEn?.tex ?? null;
                le.scaleFa = rFa ? [(rFa.w / rFa.h) * H, H] : [H, H];
                le.scaleEn = rEn ? [(rEn.w / rEn.h) * H, H] : [H, H];
                const useFa = langRef.current !== 'en';
                const tex   = useFa ? (le.texFa ?? le.texEn) : (le.texEn ?? le.texFa);
                const scale = useFa ? le.scaleFa : le.scaleEn;
                if (tex) { le.mat.map = tex; le.mat.needsUpdate = true; }
                le.sprite.scale.set(scale[0], scale[1], 1);
                le.texLoaded = true;
              }
              le.sprite.visible = inRange && le.texLoaded;
            }
            for (const le of (t.zoneLabelEntries ?? [])) {
              const dx = cp.x - le.cx, dz = cp.z - le.cz;
              const inRange = (dx * dx + dz * dz) < thSq;
              if (inRange && !le.texLoaded) {
                const rFa = le.titleFa ? makeTextLabelTexture(le.titleFa, 'rtl') : null;
                const rEn = le.titleEn ? makeTextLabelTexture(le.titleEn, 'ltr') : null;
                const H   = le.ZL_H;
                le.texFa   = rFa?.tex ?? null;
                le.texEn   = rEn?.tex ?? null;
                le.scaleFa = rFa ? [(rFa.w / rFa.h) * H, H] : [H, H];
                le.scaleEn = rEn ? [(rEn.w / rEn.h) * H, H] : [H, H];
                const useFa = langRef.current !== 'en';
                const tex   = useFa ? (le.texFa ?? le.texEn) : (le.texEn ?? le.texFa);
                const scale = useFa ? le.scaleFa : le.scaleEn;
                if (tex) { le.mat.map = tex; le.mat.needsUpdate = true; }
                le.sprite.scale.set(scale[0], scale[1], 1);
                le.texLoaded = true;
              }
              le.sprite.visible = inRange && le.texLoaded;
            }
          } else {
            for (const le of (t.labelEntries ?? [])) le.sprite.visible = false;
            for (const le of (t.zoneLabelEntries ?? [])) le.sprite.visible = false;
          }
        }
      }

      t.renderer.render(t.scene, t.camera);
    }
    animate();

    // ── Resize ────────────────────────────────────────────────────────────────
    t.resizeObs = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      t.camera.aspect = w / h;
      t.camera.updateProjectionMatrix();
      t.renderer.setSize(w, h);
    });
    t.resizeObs.observe(el);

    // Signal to parent that controlRef is populated and the render loop is running.
    onReady?.();

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(t.animId);
      t.resizeObs?.disconnect();
      t.renderer.domElement.removeEventListener("pointerdown", onPtrDown);
      t.renderer.domElement.removeEventListener("click", onClick);
      t.renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      t.renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      t.controls.dispose();
      t.disposables.forEach((d) => { d.geometry?.dispose(); d.material?.dispose(); });
      for (const le of (t.labelEntries ?? [])) {
        le.texFa?.dispose();
        le.texEn?.dispose();
        le.mat.dispose();
      }
      for (const le of (t.zoneLabelEntries ?? [])) {
        le.texFa?.dispose();
        le.texEn?.dispose();
        le.mat.dispose();
      }
      // Dispose route meshes/sprites and flow textures — not covered by t.disposables
      // (route objects are built/torn down by the route effect, but that effect has no
      // return cleanup, so we must dispose here on unmount to avoid GPU texture leaks
      // when the user has an active route and switches 3D → 2D).
      for (const o of (t.routeObjects ?? [])) {
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        } else if (o instanceof THREE.Mesh) {
          o.geometry?.dispose();
          o.material?.map?.dispose();
          o.material?.dispose();
        }
      }
      for (const tex of (t.routeTextures ?? [])) tex?.dispose();
      t.scene.clear();
      t.renderer.dispose();
      // renderer.dispose() only frees THREE's internal caches — it does NOT
      // release the underlying WebGLRenderingContext (verified against the
      // installed three.js source: dispose() never calls forceContextLoss()).
      // Every 2D<->3D toggle fully unmounts and remounts this component,
      // creating a brand-new canvas + GL context each time. Without forcing
      // context loss here, the old context stays alive (held by the browser's
      // GPU process) until the canvas is garbage-collected, which is slow and
      // unreliable. Repeated toggling within a session accumulates these
      // "zombie" contexts: reproduced locally, 40 rapid 2D<->3D toggles pinned
      // live WebGL contexts at Chrome's hard ceiling (16) with forced
      // evictions firing from toggle ~12 onward, while JS heap grew 35MB ->
      // 123MB with no release. Chrome degrades gracefully by evicting the
      // oldest context; mobile Safari's ceiling is lower and, critically, its
      // response to exceeding it is reloading the entire tab — surfacing as
      // an intermittent, seemingly gesture-random "page refresh" whenever the
      // user happens to be zooming/panning at the moment the budget tips over.
      t.renderer.forceContextLoss();
      if (el.contains(t.renderer.domElement)) el.removeChild(t.renderer.domElement);
      if (controlRef) controlRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // scene built once; halls/hallColors are populated before mount

  // ── Sync camera config whenever prop changes (t initialized once but config may change) ──
  useEffect(() => {
    const t = tRef.current;
    if (!t) return;
    t.camDist       = navCameraConfig?.distance              ?? DRONE_DIST;
    t.camH          = navCameraConfig?.height                ?? DRONE_H;
    t.walkSpeed     = navCameraConfig?.walk_speed            ?? WALK_SPEED;
    t.stairTargetDur = navCameraConfig?.stair_transition_duration ?? STAIR_TARGET_DUR;
  }, [navCameraConfig]);

  // ── Sync scene background color when theme or admin config changes ──────────
  useEffect(() => {
    const t = tRef.current;
    if (!t?.scene) return;
    try { t.scene.background = new THREE.Color(bgColor ?? '#021f20'); } catch {}
  }, [bgColor]);

  // ── Route — rebuild when navRoute / markers change ────────────────────────
  useEffect(() => {
    const t = tRef.current;
    if (!t?.scene) return;
    // Dispose previous route objects, textures, and sprites
    t.routeObjects.forEach((o) => {
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      } else if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
      t.scene.remove(o);
    });
    t.routeObjects = [];
    t.routeTextures = [];

    // Stop any in-progress first-person walkthrough whenever the route changes
    if (t.walk) { t.walk = null; t.controls.enabled = true; }
    t.walkthroughPath = null;
    t.walkthroughStairRange = null;

    if (!navRoute || navRoute.type === "computing" || navRoute.type === "no_connection") return;

    // Build a 1-D canvas texture with repeating bright dash / gap pattern
    function createFlowTexture(hexColor) {
      const W = 256;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = 2;
      const ctx = canvas.getContext("2d");
      const col = parseColor(hexColor);
      const r = Math.round(col.r * 255), g = Math.round(col.g * 255), b = Math.round(col.b * 255);
      // 5 dashes across the texture; each dash = cosine pulse, trailing gap
      for (let x = 0; x < W; x++) {
        const phase = ((x / W) * 5) % 1; // 5 repeats
        let alpha;
        if (phase < 0.58) {
          alpha = 0.3 + 0.7 * Math.pow(Math.sin((phase / 0.58) * Math.PI), 1.5);
        } else {
          alpha = 0;
        }
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
        ctx.fillRect(x, 0, 1, 2);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      return tex;
    }

    // Waze-style glowing navigation ribbon with animated directional flow.
    // stripeColor: color of the animated core tube + flow-texture dash pattern.
    // haloColor:   color of the wide soft glow surrounding the tube.
    // In dark scenes, additive blending adds the route color to the near-black background,
    // producing a bloom-like glow.  On light scenes the background is already near-white,
    // so additive blending saturates to white and the tube becomes invisible.  Normal
    // blending is used instead so the color remains visible against any background.
    const _bgLum = (() => {
      try {
        const h = (bgColor ?? '#021f20').replace('#', '');
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      } catch { return 0; }
    })();
    const _lightBg = _bgLum > 0.5;

    function addRouteTube(path2D, floorY, stripeColor, haloColor) {
      if (!path2D || path2D.length < 2) return;
      const stripe = stripeColor || '#00ffb3';
      const halo   = haloColor   || stripe;
      const pts = path2D.map((p) => new THREE.Vector3(p.x, floorY + ROUTE_Y, p.y));
      try {
        // Use piecewise-linear CurvePath (not CatmullRomCurve3) so the tube exactly
        // follows the A*-computed waypoints. CatmullRomCurve3 smooths corners with a
        // spline that can deviate inward at turns and visually cut through booth blocks,
        // undoing the obstacle avoidance that A* already correctly computed.
        const curve = new THREE.CurvePath();
        for (let i = 0; i < pts.length - 1; i++) curve.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
        const len     = curve.getLength();
        const tubeSeg = Math.max(pts.length * 6, 32);

        // Animated flow texture — repeat density proportional to path length
        const flowTex = createFlowTexture(stripe);
        flowTex.repeat.set(Math.max(3, Math.round(len / 55)), 1);
        t.routeTextures.push(flowTex);

        // Core tube — additive on dark bg (bloom glow), normal on light bg (color-accurate)
        const coreGeo = new THREE.TubeGeometry(curve, tubeSeg, 2.5, 8, false);
        const coreMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(stripe),
          map: flowTex,
          transparent: true,
          opacity: _lightBg ? 0.85 : 1.0,
          blending: _lightBg ? THREE.NormalBlending : THREE.AdditiveBlending,
          depthWrite: false,
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        t.scene.add(coreMesh);
        t.routeObjects.push(coreMesh);

        // Wide soft halo — same blending switch; higher opacity for light bg so it's visible
        const haloGeo = new THREE.TubeGeometry(curve, tubeSeg, 7, 8, false);
        const haloMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(halo),
          transparent: true,
          opacity: _lightBg ? 0.28 : 0.12,
          blending: _lightBg ? THREE.NormalBlending : THREE.AdditiveBlending,
          depthWrite: false,
        });
        const haloMesh = new THREE.Mesh(haloGeo, haloMat);
        t.scene.add(haloMesh);
        t.routeObjects.push(haloMesh);
      } catch (_) { /* skip malformed paths */ }
    }

    // Helper: sprite marker for route start/end/stairs.
    // iconOrEmoji may be a string emoji OR { type: 'builtin'|'upload', value: string }
    function addMarker(mx, mz, floorY, iconOrEmoji) {
      const icon = typeof iconOrEmoji === 'string' ? { type: 'builtin', value: iconOrEmoji } : iconOrEmoji;
      function placeSprite(tex) {
        const mat    = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(mx, floorY + BOOTH_H + 16, mz);
        sprite.scale.set(MARKER_SIZE, MARKER_SIZE, 1);
        t.scene.add(sprite);
        t.routeObjects.push(sprite);
      }
      if (icon.type === 'upload' && icon.value) {
        makeUploadTexture(icon.value).then(placeSprite);
      } else {
        placeSprite(makeEmojiTexture(icon.value ?? '📍'));
      }
    }

    // Primary (same-floor) colors
    const rStripe = routeColors?.walkthroughStripe ?? resolvedAccentColor ?? '#00ffb3';
    const rHalo   = routeColors?.walkthroughHalo   ?? resolvedAccentColor ?? '#00ffb3';
    // Secondary (cross-floor destination segment) colors
    const sStripe = routeColorsSecondary?.walkthroughStripe ?? '#f59e0b';
    const sHalo   = routeColorsSecondary?.walkthroughHalo   ?? '#f59e0b';

    if (navRoute.type === "single") {
      const floorY = (navStart?.floor ?? 0) * FLOOR_GAP;
      addRouteTube(navRoute.path, floorY, rStripe, rHalo);
      if (navStart) addMarker(navStart.x, navStart.y, floorY, navMarkerIcons?.route_start ?? "🏁");
      if (navDest)  addMarker(navDest.x,  navDest.y,  floorY, navMarkerIcons?.route_end   ?? "📍");
      // Build walkthrough path at eye-level height
      const wpts = (navRoute.path ?? []).map(p => new THREE.Vector3(p.x, floorY + EYE_H, p.y));
      t.walkthroughPath = wpts.length >= 2 ? wpts : null;
      t.walkthroughStairRange = null;
    } else if (navRoute.type === "multi_floor") {
      const { pathA, pathB, stairsFrom, stairsTo } = navRoute;
      // Use the floor values carried on the route object — navStart has no .floor property,
      // so navStart?.floor is always undefined and would silently force floorAY=0 for every
      // downward route (origin on upper floor), keeping ptsA at ground height and making
      // the stair height-change a no-op.  navRoute.startFloor/destFloor are set correctly
      // by findMultiFloorRoute for both upward and downward cross-floor paths.
      const floorAY = (navRoute.startFloor ?? 0) * FLOOR_GAP;
      const floorBY = (navRoute.destFloor  ?? 0) * FLOOR_GAP;
      addRouteTube(pathA, floorAY, rStripe, rHalo);
      addRouteTube(pathB, floorBY, sStripe, sHalo);
      if (navStart)    addMarker(navStart.x,    navStart.y,    floorAY, navMarkerIcons?.route_start ?? "🏁");
      if (stairsFrom)  addMarker(stairsFrom.x,  stairsFrom.y,  floorAY, "🪜");
      if (stairsTo)    addMarker(stairsTo.x,    stairsTo.y,    floorBY, "🪜");
      if (navDest)     addMarker(navDest.x,     navDest.y,     floorBY, navMarkerIcons?.route_end   ?? "📍");
      // Build walkthrough path: floor-A segment + 3 linearly-interpolated
      // transition waypoints across the staircase + floor-B segment.
      // Y (height) naturally increases or decreases depending on direction.
      const ptsA = (pathA ?? []).map(p => new THREE.Vector3(p.x, floorAY + EYE_H, p.y));
      const ptsB = (pathB ?? []).map(p => new THREE.Vector3(p.x, floorBY + EYE_H, p.y));
      if (ptsA.length >= 2 && ptsB.length >= 2) {
        const lastA = ptsA[ptsA.length - 1], firstB = ptsB[0];
        const mid = [1, 2, 3].map(i => {
          const f = i / 4;
          return new THREE.Vector3(
            lastA.x + (firstB.x - lastA.x) * f,
            lastA.y + (firstB.y - lastA.y) * f,
            lastA.z + (firstB.z - lastA.z) * f,
          );
        });
        t.walkthroughPath = [...ptsA, ...mid, ...ptsB];
        // Stair segment spans lastA → mid[0..2] → firstB (waypoint indices ptsA.length-1
        // through ptsA.length+3).  startWalkthrough converts these to arc-lengths so the
        // RAF loop can apply STAIR_WALK_SPEED only during that portion.
        t.walkthroughStairRange = { start: ptsA.length - 1, end: ptsA.length + 3 };
      } else {
        t.walkthroughStairRange = null;
      }
    }
  }, [navRoute, navStart, navDest, navMarkerIcons, routeColors, routeColorsSecondary, bgColor]);

  // ── Selection highlight — update booth material color when selected ───────────
  useEffect(() => {
    const t = tRef.current;
    if (!t?.boothEntries) return;

    // Reset previously highlighted meshes to their original hall color
    if (t.highlightedEntries?.length) {
      for (const entry of t.highlightedEntries) {
        entry.mesh.material.color.copy(parseColor(entry.colorStr));
      }
      t.highlightedEntries = null;
    }

    if (!selectedBoothId) return;

    // All meshes belonging to this company (a merged booth can span several boxes)
    const entries = t.boothEntries.filter(
      (e) => e.booth.company?.id === selectedBoothId
    );
    if (!entries.length) return;

    const highlight = getHighlightColor(entries[0].colorStr);
    for (const entry of entries) {
      entry.mesh.material.color.copy(highlight);
    }
    t.highlightedEntries = entries;
  }, [selectedBoothId]);

  // ── Zone selection highlight ───────────────────────────────────────────────
  useEffect(() => {
    const t = tRef.current;
    if (!t?.zoneEntries) return;

    if (t.highlightedZoneEntries?.length) {
      for (const entry of t.highlightedZoneEntries) {
        entry.mesh.material.color.copy(parseColor(entry.colorStr));
      }
      t.highlightedZoneEntries = null;
    }

    if (!selectedZoneId) return;

    const entries = t.zoneEntries.filter((e) => e.zone.id === selectedZoneId);
    if (!entries.length) return;

    const highlight = getHighlightColor(entries[0].colorStr);
    for (const entry of entries) {
      entry.mesh.material.color.copy(highlight);
    }
    t.highlightedZoneEntries = entries;
  }, [selectedZoneId]);

  // ── Label language switch — swap booth + zone sprite textures when lang changes ──
  useEffect(() => {
    const t = tRef.current;
    if (!t) return;
    const useFa = lang !== 'en';
    for (const le of (t.labelEntries ?? [])) {
      // Skip entries whose textures haven't been created yet — the RAF loop uses
      // langRef.current (kept in sync) when it creates the texture on first enter-range.
      if (!le.texLoaded) continue;
      const tex   = useFa ? (le.texFa ?? le.texEn) : (le.texEn ?? le.texFa);
      const scale = useFa ? le.scaleFa : le.scaleEn;
      if (tex) {
        // eslint-disable-next-line react-hooks/immutability
        le.mat.map = tex;
        le.mat.needsUpdate = true;
      }
      le.sprite.scale.set(scale[0], scale[1], 1);
    }
    for (const le of (t.zoneLabelEntries ?? [])) {
      if (!le.texLoaded) continue;
      const tex   = useFa ? (le.texFa ?? le.texEn) : (le.texEn ?? le.texFa);
      const scale = useFa ? le.scaleFa : le.scaleEn;
      if (tex) {
        // eslint-disable-next-line react-hooks/immutability
        le.mat.map = tex;
        le.mat.needsUpdate = true;
      }
      le.sprite.scale.set(scale[0], scale[1], 1);
    }
  }, [lang]);

  // ── Booth label zoom threshold — keep squared value on tRef for RAF loop ──
  useEffect(() => {
    const t = tRef.current;
    if (!t) return;
    const thr = boothLabelThreshold ?? 0;
    t.boothLabelThreshSq = thr > 0 ? thr * thr : 0;
  }, [boothLabelThreshold]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
}
