"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

// ── Constants ──────────────────────────────────────────────────────────────────
const BOOTH_H   = 22;    // height of each extruded booth block (map units)
const FLOOR_GAP = 200;   // vertical separation between floors (map units)
const ROUTE_Y   = 5;     // route tube sits this far above floor level

// ── Module-level helpers (no hooks) ───────────────────────────────────────────
const PRESET_ICONS = {
  exit:"🚪", entrance:"🚶", wc:"🚻", cafe:"☕", restaurant:"🍽️",
  prayer:"🕌", mic:"🎤", info:"ℹ️", medical:"🏥", parking:"🅿️", stairs:"🪜",
};

function getElementEmoji(el) {
  if (el.icon_type === "preset") return PRESET_ICONS[el.icon_value] || "📍";
  if (el.icon_type === "upload") return "📍";
  return el.icon_value || "📍";
}

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

// ── Map3DView component ────────────────────────────────────────────────────────
// Coordinate mapping: map (x, y) → Three.js world (x, floorY, y).
// Y axis is vertical/up; XZ plane is the floor.

export default function Map3DView({
  halls,        // hallGroups from MapClient (includes .floor, .groups)
  hallColors,   // { [hallName]: hexColor }
  mapElements,  // admin map_elements array
  navRoute,     // null | { type, path?, pathA?, pathB?, stairsFrom?, stairsTo? }
  navStart,     // null | { x, y, floor }
  navDest,      // null | { x, y, floor }
  tapStartMode, // bool — next tap sets route start
  onBoothTap,   // (booth, hall, { cx, cy, mergedLabel }) → void
  onGroundTap,  // (mapX, mapY) → void  — tap on empty ground in tapStartMode
  onBackgroundTap, // () → void — tap on empty space (close sheets)
  controlRef,   // ref whose .current receives { focusOnPoint, resetView, zoom }
}) {
  const mountRef = useRef(null);
  const tRef     = useRef(null); // holds all Three.js state (scene, camera, …)
  // Keep callbacks fresh without recreating the scene
  const cbRef    = useRef({ onBoothTap, tapStartMode, onGroundTap, onBackgroundTap });
  useEffect(() => {
    cbRef.current = { onBoothTap, tapStartMode, onGroundTap, onBackgroundTap };
  }, [onBoothTap, tapStartMode, onGroundTap, onBackgroundTap]);

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

    // CSS2D renderer for labels
    t.labelRenderer = new CSS2DRenderer();
    t.labelRenderer.setSize(W, H);
    Object.assign(t.labelRenderer.domElement.style, {
      position: "absolute", top: "0", left: "0", pointerEvents: "none",
    });
    el.appendChild(t.labelRenderer.domElement);

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
    t.boothEntries = []; // { mesh, booth, hall, mergedLabel, cx, cz }
    t.disposables  = []; // { geometry?, material? } — disposed on unmount
    t.labelObjects    = [];
    t.elementObjects  = [];
    t.routeObjects    = [];

    // ── Build booths ──────────────────────────────────────────────────────────
    const matCache = {};
    function getMat(colorStr) {
      if (!matCache[colorStr]) {
        const m = new THREE.MeshLambertMaterial({ color: parseColor(colorStr) });
        matCache[colorStr] = m;
        t.disposables.push({ material: m });
      }
      return matCache[colorStr];
    }

    const allXs = [], allZs = [];
    for (const hall of halls) {
      const floorY = (hall.floor ?? 0) * FLOOR_GAP;
      const color  = getHallColor(hall, hallColors);
      const mat    = getMat(color);

      for (const group of (hall.groups ?? [])) {
        const mergedLabel = boothRangeLabel(group.booths.map((b) => b.no));
        const firstBooth  = group.booths[0];
        for (const booth of group.booths) {
          const pts = hallToPointsArray(booth.bounds);
          if (pts.length < 3) continue;
          const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
          const x0 = Math.min(...xs), x1 = Math.max(...xs);
          const y0 = Math.min(...ys), y1 = Math.max(...ys);
          const bw = Math.max(x1 - x0, 1), bd = Math.max(y1 - y0, 1);
          const cx = (x0 + x1) / 2, cz = (y0 + y1) / 2;
          allXs.push(x0, x1); allZs.push(y0, y1);

          const geo  = new THREE.BoxGeometry(bw, BOOTH_H, bd);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(cx, floorY + BOOTH_H / 2, cz);
          t.scene.add(mesh);
          t.disposables.push({ geometry: geo });
          t.boothEntries.push({ mesh, booth: firstBooth, hall, mergedLabel, cx, cz });

          // Booth number label (CSS2D — always faces camera)
          if (booth.no) {
            const div = document.createElement("div");
            div.textContent = String(booth.no);
            Object.assign(div.style, {
              color: "rgba(255,255,255,0.85)",
              fontSize: "10px",
              fontWeight: "700",
              fontFamily: "Vazirmatn, Inter, sans-serif",
              pointerEvents: "none",
              textShadow: "0 1px 3px rgba(0,0,0,0.9)",
              userSelect: "none",
              whiteSpace: "nowrap",
            });
            const lbl = new CSS2DObject(div);
            lbl.position.set(cx, floorY + BOOTH_H + 3, cz);
            t.scene.add(lbl);
            t.labelObjects.push(lbl);
          }
        }
      }
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
      };
    }

    // ── RAF loop ──────────────────────────────────────────────────────────────
    function animate() {
      t.animId = requestAnimationFrame(animate);

      // Camera tween
      if (t.tween) {
        const p = Math.min(1, (performance.now() - t.tween.t0) / t.tween.dur);
        const e = 1 - (1 - p) ** 3; // cubic ease-out
        t.controls.target.lerpVectors(t.tween.startTarget, t.tween.endTarget, e);
        if (t.tween.startCamPos) t.camera.position.lerpVectors(t.tween.startCamPos, t.tween.endCamPos, e);
        if (p >= 1) t.tween = null;
      }

      t.controls.update();
      t.renderer.render(t.scene, t.camera);
      t.labelRenderer.render(t.scene, t.camera);
    }
    animate();

    // ── Resize ────────────────────────────────────────────────────────────────
    t.resizeObs = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      t.camera.aspect = w / h;
      t.camera.updateProjectionMatrix();
      t.renderer.setSize(w, h);
      t.labelRenderer.setSize(w, h);
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
      // CSS2DObjects just need scene removal (no geometry to dispose)
      t.scene.clear();
      t.renderer.dispose();
      if (el.contains(t.renderer.domElement))      el.removeChild(t.renderer.domElement);
      if (el.contains(t.labelRenderer.domElement)) el.removeChild(t.labelRenderer.domElement);
      if (controlRef) controlRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // scene built once; halls/hallColors are populated before mount

  // ── Map elements — update when data changes ───────────────────────────────
  useEffect(() => {
    const t = tRef.current;
    if (!t?.scene) return;
    t.elementObjects.forEach((o) => t.scene.remove(o));
    t.elementObjects = [];
    for (const el of (mapElements ?? [])) {
      const emoji   = getElementEmoji(el);
      const floorY  = (el.floor ?? 0) * FLOOR_GAP;
      const div     = document.createElement("div");
      div.textContent = emoji;
      Object.assign(div.style, {
        fontSize: "20px", lineHeight: "1", pointerEvents: "none",
        filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.8))",
      });
      const obj = new CSS2DObject(div);
      obj.position.set(el.x, floorY + BOOTH_H + 10, el.y);
      t.scene.add(obj);
      t.elementObjects.push(obj);
    }
  }, [mapElements]);

  // ── Route — rebuild when navRoute / markers change ────────────────────────
  useEffect(() => {
    const t = tRef.current;
    if (!t?.scene) return;
    // Dispose previous route geometry/materials; remove CSS2DObjects
    t.routeObjects.forEach((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
      t.scene.remove(o);
    });
    t.routeObjects = [];

    if (!navRoute || navRoute.type === "computing" || navRoute.type === "no_connection") return;

    // Helper: build a TubeGeometry along a 2D path at the given Y height
    function addRouteTube(path2D, floorY, hexColor) {
      if (!path2D || path2D.length < 2) return;
      const pts = path2D.map((p) => new THREE.Vector3(p.x, floorY + ROUTE_Y, p.y));
      try {
        const curve   = new THREE.CatmullRomCurve3(pts);
        const tubeSeg = Math.max(pts.length * 4, 12);
        const geo     = new THREE.TubeGeometry(curve, tubeSeg, 2.5, 6, false);
        const mat     = new THREE.MeshBasicMaterial({ color: new THREE.Color(hexColor), transparent: true, opacity: 0.88 });
        const mesh    = new THREE.Mesh(geo, mat);
        t.scene.add(mesh);
        t.routeObjects.push(mesh);
        // Arrow cones — one every ~arrowSpacing world units along the tube
        const arrowSpacing = Math.max((curve.getLength() / 6), 40);
        const count = Math.floor(curve.getLength() / arrowSpacing);
        for (let i = 1; i <= count; i++) {
          const u   = i / (count + 1);
          const pos = curve.getPointAt(u);
          const tan = curve.getTangentAt(u);
          const cGeo = new THREE.ConeGeometry(4, 10, 6);
          const cMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hexColor) });
          const cone = new THREE.Mesh(cGeo, cMat);
          cone.position.copy(pos);
          cone.position.y += 5;
          // Orient cone along tangent direction
          const up = new THREE.Vector3(0, 1, 0);
          const flat = new THREE.Vector3(tan.x, 0, tan.z).normalize();
          cone.quaternion.setFromUnitVectors(up, flat);
          t.scene.add(cone);
          t.routeObjects.push(cone);
        }
      } catch (_) { /* skip malformed paths */ }
    }

    // Helper: CSS2D emoji pin marker
    function addMarker(mx, mz, floorY, emoji) {
      const div = document.createElement("div");
      div.textContent = emoji;
      Object.assign(div.style, {
        fontSize: "24px", lineHeight: "1", pointerEvents: "none",
        filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.85))",
      });
      const obj = new CSS2DObject(div);
      obj.position.set(mx, floorY + BOOTH_H + 16, mz);
      t.scene.add(obj);
      t.routeObjects.push(obj);
    }

    if (navRoute.type === "single") {
      const floorY = (navStart?.floor ?? 0) * FLOOR_GAP;
      addRouteTube(navRoute.path, floorY, "#00ffb3");
      if (navStart) addMarker(navStart.x, navStart.y, floorY, "🏁");
      if (navDest)  addMarker(navDest.x,  navDest.y,  floorY, "📍");
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
    }
  }, [navRoute, navStart, navDest]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
}
