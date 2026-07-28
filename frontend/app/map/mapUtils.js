"use client";

// Snap coordinate to nearest integer.
// Absorbs two classes of API floating-point imprecision:
//   (a) true gaps up to ~0.28 SVG units where adjacent booths store their shared
//       boundary at slightly different coordinates in each booth's polygon, and
//   (b) FP-multiplication artifacts (e.g. 2277.985 vs 2277.9849999999997) that
//       land on opposite sides of the 0.5 threshold when multiplied by 100.
// Safe because the smallest booth dimension in the dataset is ~44 SVG units —
// no two distinct booth boundaries are ever within 0.5 units of each other.
const snapCoord = v => Math.round(v);

/**
 * Returns the outer boundary of a merged booth group as closed polygon loops.
 *
 * Each loop is an ordered array of { x, y } map-space points (integer-snapped).
 * Internal edges shared by exactly two booth polygons are omitted; outer edges
 * (belonging to exactly one polygon) are chained into closed loops.
 *
 * This is the canonical algorithm for company-group boundary computation — used
 * by both the 2D SVG stroke renderer (MapClient.jsx) and the 3D extrusion
 * builder (Map3DView.jsx).  Do not duplicate this logic; import from here.
 */
export function groupOuterLoops(booths) {
  // ── Step 1: count edge appearances ─────────────────────────────────────────
  const counts = new Map();
  for (const b of booths) {
    const pts = b.bounds ?? [];
    const n   = pts.length;
    for (let i = 0; i < n; i++) {
      const a   = pts[i];
      const bPt = pts[(i + 1) % n];
      const ax  = snapCoord(a.x),  ay = snapCoord(a.y);
      const bx  = snapCoord(bPt.x), by = snapCoord(bPt.y);
      // Canonical key: always put the "smaller" endpoint first so edge A→B and
      // B→A map to the same key.
      const key = ax < bx || (ax === bx && ay <= by)
        ? `${ax}|${ay}|${bx}|${by}`
        : `${bx}|${by}|${ax}|${ay}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  // ── Step 2: collect outer edges (count === 1) ────────────────────────────
  const outerEdges = [];
  for (const [key, cnt] of counts) {
    if (cnt === 1) {
      const [ax, ay, bx, by] = key.split("|").map(Number);
      outerEdges.push([{ x: ax, y: ay }, { x: bx, y: by }]);
    }
  }
  if (!outerEdges.length) return [];

  // ── Step 3: build adjacency map for polygon reconstruction ───────────────
  const ptKey = p => `${p.x}|${p.y}`;
  const adj   = new Map();
  for (let i = 0; i < outerEdges.length; i++) {
    const [p1, p2] = outerEdges[i];
    const k1 = ptKey(p1), k2 = ptKey(p2);
    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1).push({ to: p2, edge: i });
    adj.get(k2).push({ to: p1, edge: i });
  }

  // ── Step 4: walk closed polygon loops ────────────────────────────────────
  const usedEdges = new Set();
  const loops     = [];

  for (let startIdx = 0; startIdx < outerEdges.length; startIdx++) {
    if (usedEdges.has(startIdx)) continue;

    const [p1, p2] = outerEdges[startIdx];
    usedEdges.add(startIdx);

    const loop    = [p1];
    const goalKey = ptKey(p1);
    let current   = p2;

    // Walk until we close the loop or exhaust edges (safety cap prevents infinite loops)
    for (let step = 0; step < outerEdges.length; step++) {
      const ck = ptKey(current);
      if (ck === goalKey) break;         // closed
      loop.push(current);
      const next = (adj.get(ck) ?? []).find(n => !usedEdges.has(n.edge));
      if (!next) break;                  // dead end (degenerate data)
      usedEdges.add(next.edge);
      current = next.to;
    }

    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

/**
 * Returns an inset (shrunk-inward) copy of a closed polygon loop by `gap` map units.
 *
 * Uses the miter-intersection formula: at each vertex the new position is where
 * the two adjacent edge-offset lines meet.  Works correctly for both convex and
 * concave corners (including the inner corners of L-shaped / T-shaped groups).
 *
 * For our axis-aligned right-angle polygons the miter denominator is always 1
 * (90° corner) or 2 (collinear edges), so no degenerate / division-by-zero cases
 * arise at the GAP values used in practice.
 *
 * The inward direction is inferred from the polygon's own signed area (shoelace),
 * so the function is correct regardless of which winding the loop walker produced.
 */
export function insetPolygonLoop(loop, gap) {
  if (!loop || loop.length < 3 || gap <= 0) return loop;

  // Signed area in map coords (Y increases downward).
  // Positive → CW in screen space; negative → CCW.
  let area2 = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    area2 += a.x * b.y - b.x * a.y;
  }
  // For CW-screen (area2 > 0): inward normal of an edge is its left perpendicular.
  // For CCW-screen (area2 < 0): inward normal is its right perpendicular.
  // Unified: inward_normal = sign * (-dy, dx)  where sign = +1 for CW, -1 for CCW.
  const sign = area2 > 0 ? 1 : -1;

  const result = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const curr = loop[i];
    const next = loop[(i + 1) % n];

    const len1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const len2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (len1 < 0.001 || len2 < 0.001) { result.push({ ...curr }); continue; }

    const d1x = (curr.x - prev.x) / len1, d1y = (curr.y - prev.y) / len1;
    const d2x = (next.x - curr.x) / len2, d2y = (next.y - curr.y) / len2;

    const n1x = sign * -d1y, n1y = sign * d1x;
    const n2x = sign * -d2y, n2y = sign * d2x;

    // Miter denominator: 1 + cos(angle between normals).
    // 90° corner → denom=1; collinear edges → denom=2; never 0 for our data.
    const dot   = n1x * n2x + n1y * n2y;
    const denom = 1 + dot;
    const scale = Math.abs(denom) < 0.001 ? gap : gap / denom;

    result.push({ x: curr.x + scale * (n1x + n2x), y: curr.y + scale * (n1y + n2y) });
  }

  return result;
}
