"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { groupOuterLoops, insetPolygonLoop } from "./mapUtils.js";

// ── Constants ──────────────────────────────────────────────────────────────────
const BOOTH_H   = 22;   // height of each extruded booth block (map units)
const ZONE_H    = 10;   // height of named zone blocks (shorter, flatter than booths)
const FLOOR_GAP = 200;  // vertical separation between floors (map units)
const ROUTE_Y   = 5;    // route tube sits this far above floor level
// Inward offset applied to each company group's merged outer polygon (map units
// per side).  Creates a visible gap between DIFFERENT companies' 3D blocks while
// booths within the same company's merged block remain seamlessly joined.
// Total gap between two adjacent company blocks ≈ 2 × BOOTH_GAP (~8 units).
const BOOTH_GAP = 4;

// ── First-person walkthrough constants ────────────────────────────────────────
const EYE_H      = 14;   // camera height above floor during walkthrough (≈1.9m at 15 units/m scale)
const WALK_SPEED  = 75;  // map units per second (≈5 m/s — snappy but not disorienting)
const LOOK_AHEAD  = 35;  // units ahead on path to pick the look-at target
const LOOK_LAG    = 3.0; // look-direction lerp rate per second (higher = snappier turns)

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

function getHallColor(hall, hallColors) {
  return hallColors[hall.name] || hall.color || "#00ffb3";
}

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

// ── Map3DView component ────────────────────────────────────────────────────────
// Coordinate mapping: map (x, y) → Three.js world (x, floorY, y).
// Y axis is vertical/up; XZ plane is the floor.

export default function Map3DView({
  halls,          // hallGroups from MapClient (includes .floor, .groups)
  hallColors,     // { [hallName]: hexColor }
  zones,          // named map_zones (title_fa truthy) to render as 3D blocks
  navRoute,       // null | { type, path?, pathA?, pathB?, stairsFrom?, stairsTo? }
  navStart,       // null | { x, y, floor }
  navDest,        // null | { x, y, floor }
  tapStartMode,   // bool — next tap sets route start
  onBoothTap,     // (booth, hall, { cx, cy, mergedLabel }) → void
  onZoneTap,      // (zone, { cx, cy }) → void
  onGroundTap,    // (mapX, mapY) → void  — tap on empty ground in tapStartMode
  onBackgroundTap, // () → void — tap on empty space (close sheets)
  controlRef,     // ref whose .current receives { focusOnPoint, resetView, zoom }
  selectedBoothId, // company id of currently selected booth (or null)
  selectedZoneId,  // zone.id of currently selected zone (or null)
}) {
  const mountRef = useRef(null);
  const tRef     = useRef(null); // holds all Three.js state (scene, camera, …)
  // Keep callbacks fresh without recreating the scene
  const cbRef    = useRef({ onBoothTap, onZoneTap, tapStartMode, onGroundTap, onBackgroundTap });
  useEffect(() => {
    cbRef.current = { onBoothTap, onZoneTap, tapStartMode, onGroundTap, onBackgroundTap };
  }, [onBoothTap, onZoneTap, tapStartMode, onGroundTap, onBackgroundTap]);

  // ── Scene setup (runs once on mount, halls is populated before mount) ────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const t = {};
    tRef.current = t;

    const W = el.clientWidth  || window.innerWidth;
    const H = el.clientHeight || window.innerHeight;

    // Scene
    t.scene = new THREE.Scene();
    t.scene.background = new THREE.Color(0x021f20);

    // Camera
    t.camera = new THREE.PerspectiveCamera(48, W / H, 1, 40000);

    // WebGL renderer
    t.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    t.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    t.renderer.setSize(W, H);
    el.appendChild(t.renderer.domElement);

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

    t.raycaster   = new THREE.Raycaster();
    t.boothEntries = []; // { mesh, booth, hall, mergedLabel, cx, cz, colorStr }
    t.zoneEntries  = []; // { mesh, zone, cx, cz, colorStr }
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
      const colorStr = getHallColor(hall, hallColors);

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

    // ── Build named zones — flat boxes, shorter than booths ──────────────────
    for (const zone of (zones ?? [])) {
      const colorStr = hallColors[zone.hall_name] || "#00ffb3";
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
      const geo = new THREE.BoxGeometry(bw, ZONE_H, bd);
      const mat = new THREE.MeshLambertMaterial({ color: parseColor(colorStr), transparent: true, opacity: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, ZONE_H / 2, cz);
      t.scene.add(mesh);
      t.disposables.push({ geometry: geo, material: mat });
      t.zoneEntries.push({ mesh, zone, cx, cz, colorStr });
    }

    // ── Camera initial position ───────────────────────────────────────────────
    if (allXs.length && allZs.length) {
      const minX = Math.min(...allXs), maxX = Math.max(...allXs);
      const minZ = Math.min(...allZs), maxZ = Math.max(...allZs);
      const scX  = (minX + maxX) / 2, scZ = (minZ + maxZ) / 2;
      const span = Math.max(maxX - minX, maxZ - minZ);
      const dist = span * 0.85;
      t.controls.target.set(scX, 0, scZ);
      t.camera.position.set(scX - dist * 0.35, dist * 0.7, scZ + dist * 0.9);
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
          // Cancel any in-flight overview tween and disable user orbit input
          t.tween = null;
          t.controls.enabled = false;
          // Jump camera to start of path, facing the first look-ahead point
          const startPt = curve.getPointAt(0);
          const lookT   = Math.min(1, LOOK_AHEAD / curveLen);
          const lookPt  = curve.getPointAt(lookT);
          lookPt.y = startPt.y - 3;
          t.camera.position.copy(startPt);
          t.camera.lookAt(lookPt);
          t.walk = {
            curve,
            curveLen,
            progress:   0,
            smoothLook: lookPt.clone(),
            onComplete: onComplete ?? null,
          };
          return true;
        },

        // Stop the walkthrough early. Leaves the camera at its current position
        // and re-enables OrbitControls so the user can look around from there.
        stopWalkthrough() {
          if (!t.walk) return;
          const finalLook = t.walk.smoothLook.clone();
          t.walk = null;
          t.controls.enabled = true;
          t.controls.target.copy(finalLook);
        },
      };
    }

    // ── RAF loop ──────────────────────────────────────────────────────────────
    function animate() {
      t.animId = requestAnimationFrame(animate);
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
        ws.progress = Math.min(ws.progress + delta * WALK_SPEED, ws.curveLen);
        const tParam = ws.progress / ws.curveLen;
        const pos    = ws.curve.getPointAt(tParam);
        t.camera.position.copy(pos);

        // Smooth look-ahead: target a point LOOK_AHEAD units further along the path,
        // held at a slight downward angle (pos.y - 3) for a natural walking POV.
        const lookT = Math.min(1.0, (ws.progress + LOOK_AHEAD) / ws.curveLen);
        const ahead = ws.curve.getPointAt(lookT);
        ahead.y = pos.y - 3;
        ws.smoothLook.lerp(ahead, Math.min(1, delta * LOOK_LAG));
        t.camera.lookAt(ws.smoothLook);

        if (tParam >= 1.0) {
          // Reached destination — hand control back to OrbitControls
          const finalLook = ws.smoothLook.clone();
          const cb = ws.onComplete;
          t.walk = null;
          t.controls.enabled = true;
          t.controls.target.copy(finalLook);
          if (cb) cb();
        }
      }

      // OrbitControls update — skip during active walkthrough to avoid fighting camera
      if (!t.walk) t.controls.update();
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

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(t.animId);
      t.resizeObs?.disconnect();
      t.renderer.domElement.removeEventListener("pointerdown", onPtrDown);
      t.renderer.domElement.removeEventListener("click", onClick);
      t.controls.dispose();
      t.disposables.forEach((d) => { d.geometry?.dispose(); d.material?.dispose(); });
      t.scene.clear();
      t.renderer.dispose();
      if (el.contains(t.renderer.domElement)) el.removeChild(t.renderer.domElement);
      if (controlRef) controlRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // scene built once; halls/hallColors are populated before mount

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

    // Waze-style glowing navigation ribbon with animated directional flow
    function addRouteTube(path2D, floorY, hexColor) {
      if (!path2D || path2D.length < 2) return;
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
        const flowTex = createFlowTexture(hexColor);
        flowTex.repeat.set(Math.max(3, Math.round(len / 55)), 1);
        t.routeTextures.push(flowTex);

        // Glowing core tube (uses additive blending for bloom-like glow)
        const coreGeo = new THREE.TubeGeometry(curve, tubeSeg, 2.5, 8, false);
        const coreMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(hexColor),
          map: flowTex,
          transparent: true,
          opacity: 1.0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        t.scene.add(coreMesh);
        t.routeObjects.push(coreMesh);

        // Wide soft halo (gives the "thick glowing route" feel)
        const haloGeo = new THREE.TubeGeometry(curve, tubeSeg, 7, 8, false);
        const haloMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(hexColor),
          transparent: true,
          opacity: 0.12,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const haloMesh = new THREE.Mesh(haloGeo, haloMat);
        t.scene.add(haloMesh);
        t.routeObjects.push(haloMesh);
      } catch (_) { /* skip malformed paths */ }
    }

    // Helper: emoji sprite marker for route start/end/stairs
    function addMarker(mx, mz, floorY, emoji) {
      const tex    = makeEmojiTexture(emoji);
      const mat    = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(mx, floorY + BOOTH_H + 16, mz);
      sprite.scale.set(MARKER_SIZE, MARKER_SIZE, 1);
      t.scene.add(sprite);
      t.routeObjects.push(sprite);
    }

    if (navRoute.type === "single") {
      const floorY = (navStart?.floor ?? 0) * FLOOR_GAP;
      addRouteTube(navRoute.path, floorY, "#00ffb3");
      if (navStart) addMarker(navStart.x, navStart.y, floorY, "🏁");
      if (navDest)  addMarker(navDest.x,  navDest.y,  floorY, "📍");
      // Build walkthrough path at eye-level height
      const wpts = (navRoute.path ?? []).map(p => new THREE.Vector3(p.x, floorY + EYE_H, p.y));
      t.walkthroughPath = wpts.length >= 2 ? wpts : null;
    } else if (navRoute.type === "multi_floor") {
      const { pathA, pathB, stairsFrom, stairsTo } = navRoute;
      const floorAY = (navStart?.floor ?? 0) * FLOOR_GAP;
      const floorBY = (navDest?.floor  ?? 0) * FLOOR_GAP;
      addRouteTube(pathA, floorAY, "#00ffb3");
      addRouteTube(pathB, floorBY, "#f59e0b");
      if (navStart)    addMarker(navStart.x,    navStart.y,    floorAY, "🏁");
      if (stairsFrom)  addMarker(stairsFrom.x,  stairsFrom.y,  floorAY, "🪜");
      if (stairsTo)    addMarker(stairsTo.x,    stairsTo.y,    floorBY, "🪜");
      if (navDest)     addMarker(navDest.x,     navDest.y,     floorBY, "📍");
      // Build walkthrough path: floor-A segment + 3 interpolated transition
      // waypoints across the staircase + floor-B segment. CatmullRomCurve3
      // smooths the vertical ramp, creating a natural "going upstairs" feel.
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
      }
    }
  }, [navRoute, navStart, navDest]);

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

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
}
