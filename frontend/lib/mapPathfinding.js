// Grid-based A* pathfinding for exhibition map wayfinding.
// Booths are the primary obstacles; outer hall walls are also treated as
// barriers with walkable gaps only at entrance markers from map_signs.
// Cell size = 20 SVG units ≈ 1.3 m (calibration: ~15 SVG units = 1 m).

const CELL = 20;
const SQRT2 = Math.SQRT2;

// How many cells to pad around each hall's booth-bounds bbox (creates the wall thickness).
const WALL_PAD = CELL;
// Safety buffer around manually-drawn map_walls: cells within this distance
// of any wall segment are fully blocked so the route never hugs the wall edge.
const WALL_BUF = CELL;
// Bboxes within this many SVG units are merged into one "building" (avoids splitting
// adjacent halls A-E into separate enclosures).
const MERGE_GAP = CELL * 4;
// Half-width (in cells) of the walkable gap carved at each entrance marker.
const GAP_HALF = 2;
// Minimum SVG-unit gap between two booth footprints for the space between
// them to count as a real walkable aisle rather than a cosmetic seam.
// Measured against the live map data across all 6 halls: the widest
// cosmetic seam between visually-adjacent booths was 18.42 units, while the
// narrowest genuine inter-row aisle gap was 29.00 units (and real aisle
// gaps continue upward from there with many repeated systematic values,
// e.g. 41.42/42.88/43.84, confirming intentional row spacing). MIN_BOOTH_GAP
// sits in the empty valley between those two clusters with margin on both
// sides, so it closes real seams without narrowing any real aisle found in
// the data.
const MIN_BOOTH_GAP = 24;
// Corridor-centering post-process (see centerPathInCorridors): a softer
// preference layered on top of aStarGrid's shortest-path result, nudging
// interior waypoints toward whichever side has more clearance so routes stop
// hugging booth/wall edges when there's open space to spare. aStarGrid itself
// is untouched -- it only distinguishes blocked vs free, no cost weighting by
// distance from obstacles, and stays that way; this runs strictly after it as
// an independent, easily-disabled step.
// Max perpendicular nudge per waypoint (SVG units). Deliberately conservative
// (0.5 cells, ~0.65m) -- validated safe (respects WALL_BUF, never crosses a
// wall) against a narrow L-corridor, a wide open hall, and real IranPharma
// door->booth data before landing here; dial up if it reads as too subtle live.
const CORRIDOR_CENTER_MAX_OFFSET = CELL * 0.5;
// Fraction of the clearance imbalance between a waypoint's two perpendicular
// sides closed per nudge (0-1). Imbalance-based rather than a flat fraction
// of one side's headroom so it's self-damping: as a point approaches the
// true center the imbalance shrinks toward zero and so does the nudge,
// converging instead of being able to overshoot past center.
const CORRIDOR_CENTER_STRENGTH = 0.5;

// ── Outer-wall helpers ─────────────────────────────────────────────────────────

// Entrance detection: map_signs use a free-form `icon` emoji + title fields.
// We recognise "ورودی" (Persian), "entrance"/"entry" (English), and the 🚶 emoji.
function isEntranceSign(sign) {
  const fa = sign.title_fa || "";
  const en = (sign.title_en || "").toLowerCase();
  const ico = sign.icon || "";
  return (
    fa.includes("ورودی") ||
    en.includes("entrance") ||
    en.includes("entry") ||
    ico === "🚶"
  );
}

// Merge axis-aligned bboxes that overlap or are within `threshold` SVG units of each other.
// Returns a new array of merged bboxes. Each bbox: { x0, y0, x1, y1 }.
function mergeBboxes(boxes, threshold) {
  const result = boxes.map((b) => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i], b = result[j];
        if (
          a.x1 + threshold >= b.x0 && b.x1 + threshold >= a.x0 &&
          a.y1 + threshold >= b.y0 && b.y1 + threshold >= a.y0
        ) {
          a.x0 = Math.min(a.x0, b.x0);
          a.y0 = Math.min(a.y0, b.y0);
          a.x1 = Math.max(a.x1, b.x1);
          a.y1 = Math.max(a.y1, b.y1);
          result.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return result;
}

// Snap (px, py) to the nearest point ON the boundary of rectangle [x0,y0,x1,y1].
// If outside: clamps to the nearest boundary point.
// If inside: projects to the nearest edge.
function snapToRectBoundary(px, py, x0, y0, x1, y1) {
  if (px <= x0 || px >= x1 || py <= y0 || py >= y1) {
    return {
      x: Math.max(x0, Math.min(x1, px)),
      y: Math.max(y0, Math.min(y1, py)),
    };
  }
  const dL = px - x0, dR = x1 - px, dT = py - y0, dB = y1 - py;
  const m = Math.min(dL, dR, dT, dB);
  if (m === dL) return { x: x0, y: py };
  if (m === dR) return { x: x1, y: py };
  if (m === dT) return { x: px, y: y0 };
  return { x: px, y: y1 };
}

// ── Grid construction ──────────────────────────────────────────────────────────

// Builds a walkable grid from map dimensions, booths, entrance signs, hall data,
// and optional admin-defined map_doors.
//
// mapSigns  – array of map_signs objects (from GraphQL websiteEvent.map_signs)
// halls     – array of hall objects with nested .booths[].bounds
// mapDoors  – array of admin-managed door objects:
//               { door_type: 'entrance'|'exit', x, y, hall_name, width }
//             'entrance' doors carve bidirectional gaps (same as mapSigns entrances).
//             'exit' doors carve walkable gaps but add forbidden directed edges
//             that block A* from traversing gap→interior (outside-in), enforcing
//             the one-way inside→out constraint.
//
// True if segment (ax,ay)→(bx,by) intersects (cx,cy)→(dx,dy).
// Bounds are slightly loose (-0.001..1.001) so crossings that occur right
// at or immediately adjacent to shared vertices (where two wall segments
// meet) are caught — the original strict 0.01..0.99 range excluded those,
// creating a vertex-leak where paths could slip through a wall corner.
function _segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const dxAB = bx - ax, dyAB = by - ay;
  const dxCD = dx - cx, dyCD = dy - cy;
  const denom = dxAB * dyCD - dyAB * dxCD;
  if (Math.abs(denom) < 1e-10) return false;
  const t = ((cx - ax) * dyCD - (cy - ay) * dxCD) / denom;
  const u = ((cx - ax) * dyAB - (cy - ay) * dxAB) / denom;
  return t > -0.001 && t < 1.001 && u > -0.001 && u < 1.001;
}

// Shortest distance from point (px,py) to segment (ax,ay)→(bx,by).
function _ptSegDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-10) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

// Builds a (ax,ay,bx,by) -> boolean segment-crossing check against a grid's
// manually-drawn map_walls polylines. Shared by findGridRoute's post-RDP
// wall-crossing repair and centerPathInCorridors's nudge validation, so both
// use the exact same geometric check rather than two copies drifting apart.
function buildWallCrosser(walls) {
  const wallFlat = [];
  for (const w of (walls ?? [])) {
    const pts = Array.isArray(w.points) ? w.points : [];
    for (let i = 0; i < pts.length - 1; i++)
      wallFlat.push(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
  }
  return (ax, ay, bx, by) => {
    for (let i = 0; i < wallFlat.length; i += 4) {
      if (_segmentsIntersect(ax, ay, bx, by, wallFlat[i], wallFlat[i + 1], wallFlat[i + 2], wallFlat[i + 3]))
        return true;
    }
    return false;
  };
}

// Returns { blocked: Uint8Array, cols, rows, cellSize, forbiddenEdges: Map }.
export function buildWalkableGrid(mapW, mapH, allBooths, mapSigns = [], halls = [], mapDoors = [], mapZones = [], mapWalls = [], cellSize = CELL) {
  const cols = Math.ceil(mapW / cellSize) + 2;
  const rows = Math.ceil(mapH / cellSize) + 2;
  const blocked = new Uint8Array(cols * rows); // 0 = walkable, 1 = blocked

  // Blocks every grid cell whose CENTER lies within SVG-unit rect [x0,y0,x1,y1].
  // Shared by booth-interior blocking and inter-booth seam closing below.
  function blockRect(x0, y0, x1, y1) {
    const c0 = Math.max(0, Math.floor(x0 / cellSize - 0.5) + 1);
    const c1 = Math.min(cols - 1, Math.ceil(x1 / cellSize - 0.5) - 1);
    const r0 = Math.max(0, Math.floor(y0 / cellSize - 0.5) + 1);
    const r1 = Math.min(rows - 1, Math.ceil(y1 / cellSize - 0.5) - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        blocked[r * cols + c] = 1;
      }
    }
  }

  // ── Step 1: mark booth interiors as blocked ───────────────────────────────
  const boothBboxes = [];
  for (const booth of allBooths) {
    const pts = booth.bounds ?? [];
    if (pts.length < 2) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    boothBboxes.push({ x0: minX, y0: minY, x1: maxX, y1: maxY });
    blockRect(minX, minY, maxX, maxY);
  }

  // ── Step 1c: close cosmetic seams between near-adjacent booths ───────────
  // A booth-blocking pass with zero padding (above) leaves the thin visual
  // gap between two neighbouring booths walkable once gridded, if that gap
  // is wide enough to contain a cell center — A* then threads a route
  // through it as though it were a real aisle. For every pair of booths
  // separated by less than MIN_BOOTH_GAP, block the connecting strip
  // between them. This only touches the specific narrow gap between that
  // pair — every other edge of both booths (which may legitimately face a
  // real, wider aisle) is untouched.
  //
  // Three adjacency shapes are handled:
  //  - side-by-side (y-ranges overlap, separated in x)
  //  - stacked (x-ranges overlap, separated in y)
  //  - diagonal (neither range overlaps — near a shared corner). A*'s
  //    corner-cut guard only stops a single diagonal step between two
  //    blocked cells; it does NOT stop a route walking around through a
  //    wider open pocket in the corner gap, so this case needs the same
  //    explicit closing as the other two.
  //
  // A raw gap can be narrower than one grid cell in a dimension where no
  // cell center could ever fall (e.g. a 2-3 SVG-unit sliver against a
  // 20-unit cell) — blocking exactly that sliver blocks nothing at all.
  // padThinAxis widens any such axis to at least one full cell, centered on
  // the true gap, so the seam always catches at least one row/column.
  function padThinAxis(s0, s1) {
    if (s1 - s0 >= cellSize) return [s0, s1];
    const mid = (s0 + s1) / 2;
    return [mid - cellSize / 2, mid + cellSize / 2];
  }

  for (let i = 0; i < boothBboxes.length; i++) {
    const a = boothBboxes[i];
    for (let j = i + 1; j < boothBboxes.length; j++) {
      const b = boothBboxes[j];
      const xGap = Math.max(a.x0 - b.x1, b.x0 - a.x1); // > 0 if x-ranges don't overlap
      const yGap = Math.max(a.y0 - b.y1, b.y0 - a.y1); // > 0 if y-ranges don't overlap
      if (xGap > 0 && yGap < 0) {
        // Side-by-side: y-ranges overlap, thin horizontal seam of width xGap.
        if (xGap >= MIN_BOOTH_GAP) continue;
        const leftIsA = a.x1 <= b.x0;
        const [sx0, sx1] = padThinAxis(leftIsA ? a.x1 : b.x1, leftIsA ? b.x0 : a.x0);
        blockRect(sx0, Math.max(a.y0, b.y0), sx1, Math.min(a.y1, b.y1));
      } else if (yGap > 0 && xGap < 0) {
        // Stacked: x-ranges overlap, thin vertical seam of height yGap.
        if (yGap >= MIN_BOOTH_GAP) continue;
        const topIsA = a.y1 <= b.y0;
        const [sy0, sy1] = padThinAxis(topIsA ? a.y1 : b.y1, topIsA ? b.y0 : a.y0);
        blockRect(Math.max(a.x0, b.x0), sy0, Math.min(a.x1, b.x1), sy1);
      } else if (xGap > 0 && yGap > 0) {
        // Diagonal: neither range overlaps — bridge the corner pocket.
        if (Math.hypot(xGap, yGap) >= MIN_BOOTH_GAP) continue;
        const leftIsA = a.x0 > b.x1;
        const topIsA = a.y0 > b.y1;
        const [sx0, sx1] = padThinAxis(leftIsA ? b.x1 : a.x1, leftIsA ? a.x0 : b.x0);
        const [sy0, sy1] = padThinAxis(topIsA ? b.y1 : a.y1, topIsA ? a.y0 : b.y0);
        blockRect(sx0, sy0, sx1, sy1);
      }
    }
  }

  // ── Step 1b: mark custom zones as blocked (rectangle / circle / polygon) ──
  for (const zone of (mapZones ?? [])) {
    if (!zone.is_blocking) continue;
    const shape = zone.shape_type || 'rectangle';

    if (shape === 'circle' && zone.cx != null && zone.radius != null) {
      // Bounding box of circle for outer scan, then distance check per cell
      const r2 = zone.radius * zone.radius;
      const c0 = Math.max(0, Math.floor((zone.cx - zone.radius) / cellSize));
      const c1 = Math.min(cols - 1, Math.ceil((zone.cx + zone.radius) / cellSize));
      const r0 = Math.max(0, Math.floor((zone.cy - zone.radius) / cellSize));
      const r1 = Math.min(rows - 1, Math.ceil((zone.cy + zone.radius) / cellSize));
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const cellCx = (col + 0.5) * cellSize;
          const cellCy = (row + 0.5) * cellSize;
          const dx = cellCx - zone.cx, dy = cellCy - zone.cy;
          if (dx * dx + dy * dy <= r2) blocked[row * cols + col] = 1;
        }
      }
    } else if (shape === 'polygon' && Array.isArray(zone.points) && zone.points.length >= 3) {
      // Bounding box for outer scan, then ray-cast per cell
      const pts = zone.points;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      const c0 = Math.max(0, Math.floor(minX / cellSize));
      const c1 = Math.min(cols - 1, Math.ceil(maxX / cellSize));
      const r0 = Math.max(0, Math.floor(minY / cellSize));
      const r1 = Math.min(rows - 1, Math.ceil(maxY / cellSize));
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const px = (col + 0.5) * cellSize, py = (row + 0.5) * cellSize;
          let inside = false;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
            if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
              inside = !inside;
          }
          if (inside) blocked[row * cols + col] = 1;
        }
      }
    } else {
      // Default: rectangle (x1,y1,x2,y2)
      if (zone.x1 == null) continue;
      const zx0 = Math.min(zone.x1, zone.x2);
      const zx1 = Math.max(zone.x1, zone.x2);
      const zy0 = Math.min(zone.y1, zone.y2);
      const zy1 = Math.max(zone.y1, zone.y2);
      const c0 = Math.max(0, Math.floor(zx0 / cellSize));
      const c1 = Math.min(cols - 1, Math.ceil(zx1 / cellSize));
      const r0 = Math.max(0, Math.floor(zy0 / cellSize));
      const r1 = Math.min(rows - 1, Math.ceil(zy1 / cellSize));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          blocked[r * cols + c] = 1;
        }
      }
    }
  }

  // ── Step 2: outer wall construction (requires hall data) ──────────────────
  const emptyGrid = { blocked, cols, rows, cellSize, forbiddenEdges: new Map(), exitGapCells: new Set() };
  if (halls.length === 0) return emptyGrid;

  // Compute each hall's bbox from its booths' actual positions.
  const rawBboxes = [];
  for (const hall of halls) {
    const pts = (hall.booths ?? []).flatMap((b) => b.bounds ?? []);
    if (pts.length < 4) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    // Pad outward by WALL_PAD to include the outer aisle + wall thickness.
    rawBboxes.push({ x0: x0 - WALL_PAD, y0: y0 - WALL_PAD, x1: x1 + WALL_PAD, y1: y1 + WALL_PAD });
  }

  if (rawBboxes.length === 0) return emptyGrid;

  // Merge adjacent/overlapping bboxes so halls in the same physical building
  // are treated as one enclosure (e.g. halls A-E form one building; H is separate).
  const buildings = mergeBboxes(rawBboxes, MERGE_GAP);

  // ── Steps 3–5: outer-wall ring and one-way door gaps ─────────────────────
  // Requires at least one gap source (entrance sign or admin door) to know
  // where to carve walkable openings in the perimeter wall.  When no gap
  // sources exist this block is skipped entirely; manual walls (Step 6) still
  // run unconditionally below.

  const forbiddenEdges = new Map(); // Map<fromCellIdx, Set<toCellIdx>>
  let innerBboxes = []; // populated below when door/sign data is present
  // Exit gap cells are hoisted here so findGridRoute can use them when snapping
  // the START point: snapping the origin onto an exit gap cell causes A* to be
  // immediately forced outside (exitGap→interior is forbidden), producing a route
  // that loops around the outside of the building instead of through the corridor.
  let exitGapCells = new Set();

  function addForbiddenEdge(from, to) {
    let s = forbiddenEdges.get(from);
    if (!s) { s = new Set(); forbiddenEdges.set(from, s); }
    s.add(to);
  }

  const entrancesFromSigns = (mapSigns ?? []).filter(isEntranceSign);
  const activeDoors = (mapDoors ?? []).filter(d => d.is_active !== false);

  if (entrancesFromSigns.length > 0 || activeDoors.length > 0) {
    // ── Step 3: carve gap cells at each entrance / door ──────────────────

    // gapCells          — all walkable gap cells (all door types)
    // exitGapCells      — exit-only doors (inside→outside): forbid gap → interior
    //                     (declared at function scope so findGridRoute can access it)
    // entranceOnlyGapCells — entrance-only doors (outside→inside): forbid interior → gap
    const gapCells = new Set();
    // exitGapCells is the outer let (not re-declared here)
    const entranceOnlyGapCells = new Set();

    // Helper: snap (px,py) to nearest building boundary and carve grid cells.
    // doorType: 'entrance' (bidirectional), 'entrance_only' (in only), 'exit' (out only)
    function carveGap(px, py, halfW, doorType) {
      let nearest = null, nearestDist = Infinity;
      for (const bldg of buildings) {
        const dx = Math.max(bldg.x0 - px, 0, px - bldg.x1);
        const dy = Math.max(bldg.y0 - py, 0, py - bldg.y1);
        const d = Math.hypot(dx, dy);
        if (d < nearestDist) { nearestDist = d; nearest = bldg; }
      }
      let snapX = px, snapY = py;
      if (nearest) {
        const s = snapToRectBoundary(px, py, nearest.x0, nearest.y0, nearest.x1, nearest.y1);
        snapX = s.x; snapY = s.y;
      }
      const gc = Math.round(snapX / cellSize);
      const gr = Math.round(snapY / cellSize);
      for (let dr = -halfW; dr <= halfW; dr++) {
        for (let dc = -halfW; dc <= halfW; dc++) {
          const nr = gr + dr, nc = gc + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const idx = nr * cols + nc;
            gapCells.add(idx);
            if (doorType === 'exit') exitGapCells.add(idx);
            if (doorType === 'entrance_only') entranceOnlyGapCells.add(idx);
          }
        }
      }
    }

    // Carve gaps from Rasayesh entrance signs (always bidirectional).
    for (const ent of entrancesFromSigns) {
      const ex = ent.coords?.x, ey = ent.coords?.y;
      if (ex == null || ey == null) continue;
      carveGap(ex, ey, GAP_HALF, 'entrance');
    }

    // Carve gaps from admin-defined doors.
    for (const door of activeDoors) {
      if (door.x == null || door.y == null) continue;
      const halfW = Math.max(1, Math.round(door.width ?? GAP_HALF));
      carveGap(door.x, door.y, halfW, door.door_type ?? 'entrance');
    }

    // ── Step 4: block only the wall ring (outer bbox minus inner bbox) ────
    //
    // IMPORTANT: exterior cells (outside ALL building bboxes) are intentionally
    // left WALKABLE.  Previously they were blocked, which caused the following
    // bug: a start point placed outside the building fell in a blocked exterior
    // cell; nearestWalkable() spiralled outward and — because the wall ring is
    // only 1 cell thick (WALL_PAD == cellSize) — found the first interior cell
    // at Chebyshev distance 2 (straight through the wall), causing A* to begin
    // inside the building without ever passing through a door gap.
    //
    // With exterior cells walkable:
    //   • Outside start points are already on a walkable cell → no snap.
    //   • A* routes along the exterior to the nearest gap cell, enters there,
    //     and continues inside to the destination.
    //
    // Gap cells override wall-ring blocking and stay walkable regardless.

    innerBboxes = buildings.map((b) => ({
      x0: b.x0 + WALL_PAD,
      y0: b.y0 + WALL_PAD,
      x1: b.x1 - WALL_PAD,
      y1: b.y1 - WALL_PAD,
    }));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (blocked[r * cols + c]) continue; // already booth-blocked (step 1)
        if (gapCells.has(r * cols + c)) continue; // door gap: always walkable

        const cx = (c + 0.5) * cellSize;
        const cy = (r + 0.5) * cellSize;

        // Only block cells that fall inside a building bbox but OUTSIDE its
        // inner bbox (= the wall ring).  Exterior cells (not inside any bbox)
        // are left walkable so outside-start routing works correctly.
        for (let i = 0; i < buildings.length; i++) {
          const b = buildings[i];
          if (cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1) {
            const ib = innerBboxes[i];
            if (!(cx >= ib.x0 && cx <= ib.x1 && cy >= ib.y0 && cy <= ib.y1)) {
              blocked[r * cols + c] = 1; // wall ring cell → blocked
            }
            // Interior cell: leave walkable (booths already blocked from step 1)
            break;
          }
          // Exterior cell (no building bbox matched): leave walkable
        }
      }
    }

    // ── Step 5: forbidden directed edges for one-way gaps ────────────────
    //
    // exit door (inside→out only):
    //   forbid: exitGapCell → interiorCell   (prevents outside→inside routing)
    //   allow:  interiorCell → exitGapCell   (inside→outside routing works fine)
    //
    // entrance_only door (outside→in only):
    //   forbid: interiorCell → entranceOnlyGapCell  (prevents inside→outside routing)
    //   allow:  entranceOnlyGapCell → interiorCell  (outside→inside works fine)

    // exit gaps: gap → interior is forbidden
    for (const idx of exitGapCells) {
      const gr = Math.floor(idx / cols);
      const gc = idx - gr * cols;
      for (const [dc, dr] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
        const nc = gc + dc, nr = gr + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (blocked[ni]) continue;
        const ncx = (nc + 0.5) * cellSize, ncy = (nr + 0.5) * cellSize;
        for (const ib of innerBboxes) {
          if (ncx >= ib.x0 && ncx <= ib.x1 && ncy >= ib.y0 && ncy <= ib.y1) {
            addForbiddenEdge(idx, ni); // exit gap → interior is forbidden
            break;
          }
        }
      }
    }

    // entrance_only gaps: interior → gap is forbidden
    for (const idx of entranceOnlyGapCells) {
      const gr = Math.floor(idx / cols);
      const gc = idx - gr * cols;
      for (const [dc, dr] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
        const nc = gc + dc, nr = gr + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (blocked[ni]) continue;
        const ncx = (nc + 0.5) * cellSize, ncy = (nr + 0.5) * cellSize;
        for (const ib of innerBboxes) {
          if (ncx >= ib.x0 && ncx <= ib.x1 && ncy >= ib.y0 && ncy <= ib.y1) {
            addForbiddenEdge(ni, idx); // interior → entrance_only gap is forbidden
            break;
          }
        }
      }
    }
  }

  // ── Step 6: wall buffer (blocked cells) + wall-crossing forbidden edges ──
  //
  // Two-layer defence for each wall polyline segment (Ax,Ay)→(Bx,By):
  //
  // Layer 1 — safety buffer: mark every grid cell whose centre is within
  //   WALL_BUF of the segment as blocked[].  This forces A* to route at
  //   least 1 cell away from the wall, so the displayed route never hugs
  //   the wall edge.  Same mechanism as booth blocking (Step 1).
  //
  // Layer 2 — crossing edges: for cells just outside the buffer, register
  //   forbidden directed edges for any cell-to-cell step whose centre-to-
  //   centre line crosses the wall segment.  Belt-and-suspenders guard for
  //   cells right at the buffer boundary.
  //
  // Scan radius is extended to cover the buffer zone (bufCells extra on
  // each side beyond the segment bounding box).
  const bufCells = Math.ceil(WALL_BUF / cellSize) + 1;
  for (const wall of (mapWalls ?? [])) {
    const pts = Array.isArray(wall.points) ? wall.points : [];
    if (pts.length < 2) continue;
    for (let si = 0; si < pts.length - 1; si++) {
      const wx1 = pts[si].x, wy1 = pts[si].y;
      const wx2 = pts[si + 1].x, wy2 = pts[si + 1].y;
      // Skip zero-length segments — they can never block anything and would
      // cause _ptSegDist to return point-distance (handled) but _segmentsIntersect
      // returns false for all paths (denom=0 check), so the forbidden-edge layer
      // is moot.
      if (wx1 === wx2 && wy1 === wy2) continue;
      const scMin = Math.max(0, Math.floor(Math.min(wx1, wx2) / cellSize) - bufCells);
      const scMax = Math.min(cols - 1, Math.ceil(Math.max(wx1, wx2) / cellSize) + bufCells);
      const srMin = Math.max(0, Math.floor(Math.min(wy1, wy2) / cellSize) - bufCells);
      const srMax = Math.min(rows - 1, Math.ceil(Math.max(wy1, wy2) / cellSize) + bufCells);
      for (let r = srMin; r <= srMax; r++) {
        for (let c = scMin; c <= scMax; c++) {
          const ccx = (c + 0.5) * cellSize, ccy = (r + 0.5) * cellSize;
          // Layer 1: buffer cell — block it and skip edge check (redundant on blocked cells).
          if (_ptSegDist(ccx, ccy, wx1, wy1, wx2, wy2) < WALL_BUF) {
            blocked[r * cols + c] = 1;
            continue;
          }
          // Layer 2: crossing edges for cells outside the buffer.
          for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
            const nc = c + dc, nr = r + dr;
            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
            const ncx = (nc + 0.5) * cellSize, ncy = (nr + 0.5) * cellSize;
            if (_segmentsIntersect(ccx, ccy, ncx, ncy, wx1, wy1, wx2, wy2)) {
              addForbiddenEdge(r * cols + c, nr * cols + nc);
              addForbiddenEdge(nr * cols + nc, r * cols + c);
            }
          }
        }
      }
    }
  }

  // `walls` is kept on the grid so findGridRoute can repair RDP-simplified segments
  // that visually cross a wall even though the raw A* path correctly avoids it.
  // `innerBboxes` is used by nearestWalkable to prefer interior snap targets over exterior.
  // `exitGapCells` is used by findGridRoute to avoid snapping the START point onto a cell
  // whose only outward edges to the interior are forbidden (exit-door one-way constraint),
  // which would force A* outside the building and around to another entrance.
  return { blocked, cols, rows, cellSize, forbiddenEdges, walls: mapWalls ?? [], innerBboxes, exitGapCells };
}

// ── Nearest walkable cell (Chebyshev spiral) ──────────────────────────────────

// avoidSet: optional Set of cell indices to skip during snapping.  Used when
// snapping the START point to exclude exit-gap cells — those cells have forbidden
// edges (exitGap → interior) that force A* outside the building even when the
// origin is inside, producing a route that loops around the exterior.
//
// avoidExterior: when true, exterior cells (outside all innerBboxes) are skipped
// entirely during the spiral.  Used when snapping the DESTINATION: if the raw
// destination falls inside a large blocking zone (e.g. a stage), the zone cells
// occupy the building interior and exterior walkable cells appear closer in the
// Chebyshev spiral than interior corridor cells.  Without this flag, the snap
// lands outside the building and A* routes via the exterior.  If no interior
// walkable cell exists at all, falls back to a second pass without the constraint.
function nearestWalkable(blocked, cols, rows, c, r, innerBboxes, cellSize, avoidSet = null, avoidExterior = false) {
  if (!blocked[r * cols + c] && !avoidSet?.has(r * cols + c)) return { c, r };
  const hasInner = innerBboxes && innerBboxes.length > 0 && cellSize;
  for (let d = 1; d < Math.max(cols, rows); d++) {
    let bestInterior = null, bestExterior = null;
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.abs(dr) !== d && Math.abs(dc) !== d) continue;
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        if (blocked[nr * cols + nc]) continue;
        if (avoidSet?.has(nr * cols + nc)) continue; // skip exit-gap cells for start snap
        if (!hasInner) return { c: nc, r: nr };
        // Classify as interior (inside a hall) vs exterior
        const cx = (nc + 0.5) * cellSize, cy = (nr + 0.5) * cellSize;
        const isInterior = innerBboxes.some(
          (ib) => cx >= ib.x0 && cx <= ib.x1 && cy >= ib.y0 && cy <= ib.y1
        );
        if (isInterior) { if (!bestInterior) bestInterior = { c: nc, r: nr }; }
        else if (!avoidExterior) { if (!bestExterior) bestExterior = { c: nc, r: nr }; }
      }
    }
    // Prefer an interior cell — only fall back to exterior if nothing interior found at this d
    if (bestInterior) return bestInterior;
    if (bestExterior) return bestExterior;
  }
  // avoidExterior was set but no interior cell found anywhere — fall back unconstrained.
  if (avoidExterior) return nearestWalkable(blocked, cols, rows, c, r, innerBboxes, cellSize, avoidSet, false);
  return { c, r };
}

// ── 8-directional A* on the blocked grid ─────────────────────────────────────

const DIRS = [
  [0, 1, 1], [0, -1, 1], [1, 0, 1], [-1, 0, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

function aStarGrid(blocked, cols, rows, sc, sr, ec, er, forbiddenEdges) {
  if (sc === ec && sr === er) return [[sc, sr]];

  const N = cols * rows;
  const gScore = new Float32Array(N).fill(Infinity);
  const cameFrom = new Int32Array(N).fill(-1);
  const inOpen = new Uint8Array(N);

  const h = (c, r) => Math.hypot(c - ec, r - er);
  const fScore = new Float32Array(N).fill(Infinity);
  const open = new Set();

  const si = sr * cols + sc;
  gScore[si] = 0;
  fScore[si] = h(sc, sr);
  open.add(si);
  inOpen[si] = 1;

  while (open.size > 0) {
    let cur = -1, curF = Infinity;
    for (const id of open) {
      if (fScore[id] < curF) { curF = fScore[id]; cur = id; }
    }

    const cr = Math.floor(cur / cols);
    const cc = cur - cr * cols;

    if (cc === ec && cr === er) {
      const path = [];
      let k = cur;
      while (k !== -1) {
        const kr = Math.floor(k / cols);
        path.unshift([k - kr * cols, kr]);
        k = cameFrom[k];
      }
      return path;
    }

    open.delete(cur);
    inOpen[cur] = 0;

    // Check exit-door directional constraint for the current cell.
    const curForbidden = forbiddenEdges?.size > 0 ? forbiddenEdges.get(cur) : undefined;

    for (const [dc, dr, cost] of DIRS) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      if (blocked[nr * cols + nc]) continue;
      // Prevent diagonal corner-cutting through booth walls.
      if (dc !== 0 && dr !== 0) {
        if (blocked[cr * cols + (cc + dc)]) continue;
        if (blocked[(cr + dr) * cols + cc]) continue;
      }
      const ni = nr * cols + nc;
      // Skip if this edge is forbidden (exit-door one-way constraint).
      if (curForbidden?.has(ni)) continue;
      const ng = gScore[cur] + cost;
      if (ng < gScore[ni]) {
        cameFrom[ni] = cur;
        gScore[ni] = ng;
        fScore[ni] = ng + h(nc, nr);
        if (!inOpen[ni]) { open.add(ni); inOpen[ni] = 1; }
      }
    }
  }

  return null;
}

// ── Douglas-Peucker path simplification ──────────────────────────────────────

function rdp(pts, eps) {
  if (pts.length <= 2) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const abx = b.x - a.x, aby = b.y - a.y;
  const ab2 = abx * abx + aby * aby;
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    let d;
    if (ab2 < 1e-10) {
      d = Math.hypot(p.x - a.x, p.y - a.y);
    } else {
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / ab2));
      d = Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
    }
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > eps) {
    const L = rdp(pts.slice(0, maxI + 1), eps);
    const R = rdp(pts.slice(maxI), eps);
    return [...L.slice(0, -1), ...R];
  }
  return [pts[0], pts[pts.length - 1]];
}

// ── Corridor centering ────────────────────────────────────────────────────────

// Nudges each interior waypoint of a finalized path perpendicular to its local
// travel direction, toward whichever side has more clearance from blocked
// cells. path[0] and path[last] (booth/entrance endpoints) are never touched.
// Purely cosmetic post-processing: never changes which cells were searched or
// how many waypoints exist, only where interior ones sit -- so it composes
// safely after aStarGrid, RDP simplification, and the wall-crossing repair
// loop without needing to know about any of them.
//
// To disable entirely, comment out its call site in findGridRoute below.
function centerPathInCorridors(path, grid) {
  if (path.length < 3) return path; // nothing but start/end -- no interior points

  const { blocked, cols, rows, cellSize } = grid;
  const crossesWall = buildWallCrosser(grid.walls);

  const isBlockedAt = (x, y) => {
    const c = Math.floor(x / cellSize), r = Math.floor(y / cellSize);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return true;
    return !!blocked[r * cols + c];
  };

  // isBlockedAt alone only proves the *endpoint* of a candidate segment is
  // walkable -- it says nothing about the segment itself. Booths are never
  // turned into wall segments (only rasterized into blocked[]), so
  // crossesWall can't see them either. Together this let a nudge produce a
  // segment whose both endpoints are clear but whose middle clips straight
  // through a booth corner (confirmed against real production map data:
  // ~48% of sampled routes cut through an unrelated booth this way, some by
  // up to ~30 SVG units / ~2m). Sample the whole segment at a fixed
  // sub-cell step so a corner clip can't hide between two sample points.
  const SEGMENT_SAMPLE_STEP = cellSize / 4;
  const segmentBlocked = (ax, ay, bx, by) => {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) return isBlockedAt(ax, ay);
    const steps = Math.max(1, Math.ceil(len / SEGMENT_SAMPLE_STEP));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (isBlockedAt(ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
    }
    return false;
  };

  // Ray-march from (x,y) along unit direction (dx,dy), returning the distance
  // to the first blocked cell (or maxDist if none found within range).
  function clearance(x, y, dx, dy, maxDist) {
    const step = cellSize / 2;
    for (let d = step; d <= maxDist; d += step) {
      if (isBlockedAt(x + dx * d, y + dy * d)) return d - step;
    }
    return maxDist;
  }

  // Cap the ray-march at just beyond what a max-strength nudge could ever
  // need -- no reason to search further than that.
  const searchCap = CORRIDOR_CENTER_MAX_OFFSET + WALL_BUF + cellSize;

  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prevOut = out[out.length - 1]; // already-finalized (possibly nudged)
    const prevOrig = path[i - 1];
    const nextOrig = path[i + 1];
    const cur = path[i];

    // Local direction from the original (pre-nudge) neighbors -- stable,
    // doesn't depend on nudge history.
    let ddx = nextOrig.x - prevOrig.x, ddy = nextOrig.y - prevOrig.y;
    const len = Math.hypot(ddx, ddy);
    if (len < 1e-6) { out.push(cur); continue; } // degenerate, leave as-is
    ddx /= len; ddy /= len;
    const px = -ddy, py = ddx; // perpendicular unit vector

    const cPlus  = clearance(cur.x, cur.y,  px,  py, searchCap);
    const cMinus = clearance(cur.x, cur.y, -px, -py, searchCap);
    const imbalance = cPlus - cMinus;
    if (Math.abs(imbalance) < 1) { out.push(cur); continue; } // already balanced

    const dir = imbalance > 0 ? 1 : -1;
    const sideClearance = dir > 0 ? cPlus : cMinus;
    // Never eat into the far side's WALL_BUF margin, regardless of how large
    // the imbalance or MAX_OFFSET would otherwise allow.
    const offset = Math.min(
      CORRIDOR_CENTER_MAX_OFFSET,
      CORRIDOR_CENTER_STRENGTH * Math.abs(imbalance) / 2,
      Math.max(0, sideClearance - WALL_BUF),
    );
    if (offset < 1) { out.push(cur); continue; }

    const nx = cur.x + px * dir * offset;
    const ny = cur.y + py * dir * offset;

    // Validate against the actual segments this nudge would produce: the
    // incoming one from the already-finalized previous output point, and the
    // outgoing one to the next original point (re-validated again, against
    // this point's now-finalized position, when that next point is processed).
    // Reject and keep the original point on any wall-crossing or blocked-cell hit
    // -- segmentBlocked (not just isBlockedAt on the new endpoint) is what
    // actually catches a corner clip through a booth; crossesWall stays for
    // exact (non-sampled) explicit map_walls geometry.
    if (
      crossesWall(prevOut.x, prevOut.y, nx, ny) ||
      crossesWall(nx, ny, nextOrig.x, nextOrig.y) ||
      segmentBlocked(prevOut.x, prevOut.y, nx, ny) ||
      segmentBlocked(nx, ny, nextOrig.x, nextOrig.y)
    ) {
      out.push(cur);
      continue;
    }

    out.push({ x: nx, y: ny });
  }
  out.push(path[path.length - 1]);
  return out;
}

// ── Multi-floor support ────────────────────────────────────────────────────────

// Build one walkable grid per floor.
// `halls` must have a `floor` property (integer, default 0) on each entry.
// Each floor's grid only includes that floor's halls as buildings, so cells
// belonging to another floor's halls are blocked — A* stays on one floor.
// `mapDoors` are filtered per floor by matching `door.hall_name` to that floor's
// halls; doors with no hall_name are included in every floor's grid.
// Returns an object keyed by floor number: { 0: grid, 1: grid, ... }.
// Helper: resolve a wall/zone's floor number.
// If hall_name is set, look it up in hallFloors (defaulting to 0 if unrecognised).
// If hall_name is NULL or empty string (admin forgot to tag it), default to floor 0
// rather than spreading it across every floor.  This means the wall will block
// pathfinding on floor 0 only — correct for virtually all single-floor venues
// and a safe fallback for multi-floor ones.  Admin should always tag hall_name on
// multi-floor maps; this prevents the wall from being silently ignored.
function resolveFloor(hallName, hallFloors) {
  if (!hallName) return 0; // NULL or "" → floor 0 fallback
  return hallFloors[hallName] ?? 0;
}

export function buildFloorGrids(mapW, mapH, halls, mapSigns = [], mapDoors = [], mapZones = [], hallFloors = {}, mapWalls = [], cellSize = CELL) {
  const floorSet = [...new Set(halls.map(h => h.floor ?? 0))];
  if (floorSet.length <= 1) {
    const f = floorSet[0] ?? 0;
    const booths = halls.flatMap(h => h.booths ?? []);
    const floorZones = (mapZones ?? []).filter(z => resolveFloor(z.hall_name, hallFloors) === f);
    const floorWalls = (mapWalls ?? []).filter(w => resolveFloor(w.hall_name, hallFloors) === f);
    return { [f]: buildWalkableGrid(mapW, mapH, booths, mapSigns, halls, mapDoors, floorZones, floorWalls, cellSize) };
  }
  const grids = {};
  for (const floor of floorSet) {
    const floorHalls = halls.filter(h => (h.floor ?? 0) === floor);
    const floorHallNames = new Set(floorHalls.map(h => h.name));
    const floorDoors = (mapDoors ?? []).filter(d => !d.hall_name || floorHallNames.has(d.hall_name));
    const floorBooths = floorHalls.flatMap(h => h.booths ?? []);
    const floorZones = (mapZones ?? []).filter(z => resolveFloor(z.hall_name, hallFloors) === floor);
    const floorWalls = (mapWalls ?? []).filter(w => resolveFloor(w.hall_name, hallFloors) === floor);
    grids[floor] = buildWalkableGrid(mapW, mapH, floorBooths, mapSigns, floorHalls, floorDoors, floorZones, floorWalls, cellSize);
  }
  return grids;
}

// Find a route that may cross floors via staircase map_elements.
//
// floorGrids  — result of buildFloorGrids
// stairsEls   — map_elements with icon_value='stairs', each having:
//               { id, x, y, floor, linked_element_id }
//
// Returns one of:
//   { type: 'single',     path }
//   { type: 'multi_floor', pathA, pathB, stairsFrom, stairsTo, startFloor, destFloor }
//   { type: 'no_connection' }   ← no valid staircase pair found or no route possible
//   null                        ← grids missing
export function findMultiFloorRoute(
  floorGrids, startX, startY, startFloor,
  destX, destY, destFloor,
  stairsEls = []
) {
  if (!floorGrids) return null;

  const availableFloors = Object.keys(floorGrids).map(Number);
  const normFloor = f => availableFloors.includes(f) ? f : (availableFloors[0] ?? 0);
  const sf = normFloor(startFloor);
  const df = normFloor(destFloor);

  // Same floor — run normal single-floor A*.
  if (sf === df) {
    const grid = floorGrids[sf];
    if (!grid) return null;
    const path = findGridRoute(grid, startX, startY, destX, destY);
    return path ? { type: 'single', path } : null;
  }

  // Different floors — need a staircase pair linking sf → df.
  const startFloorStairs = stairsEls.filter(
    el => (el.floor ?? 0) === sf && el.linked_element_id != null
  );
  const destFloorStairsById = new Map(
    stairsEls
      .filter(el => (el.floor ?? 0) === df)
      .map(el => [el.id, el])
  );

  // Valid pairs: a stairs on sf whose linked_element_id is a stairs on df.
  const validPairs = startFloorStairs
    .filter(el => destFloorStairsById.has(el.linked_element_id))
    .map(el => ({
      startStairs: el,
      destStairs: destFloorStairsById.get(el.linked_element_id),
      distToStart: Math.hypot(el.x - startX, el.y - startY),
    }))
    .sort((a, b) => a.distToStart - b.distToStart);

  if (validPairs.length === 0) return { type: 'no_connection' };

  // Try pairs in order of proximity to start; return the first that routes successfully.
  const gridSf = floorGrids[sf];
  const gridDf = floorGrids[df];
  if (!gridSf || !gridDf) return { type: 'no_connection' };

  for (const { startStairs, destStairs } of validPairs) {
    const pathA = findGridRoute(gridSf, startX, startY, startStairs.x, startStairs.y);
    const pathB = findGridRoute(gridDf, destStairs.x, destStairs.y, destX, destY);
    if (pathA && pathB) {
      return {
        type: 'multi_floor',
        pathA,
        pathB,
        stairsFrom: startStairs,  // stairs on start floor
        stairsTo: destStairs,     // paired stairs on dest floor
        startFloor: sf,
        destFloor: df,
      };
    }
  }

  return { type: 'no_connection' };
}

// ── Public API ────────────────────────────────────────────────────────────────

// Euclidean length of a [{x,y}] polyline.
export function pathLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++)
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return total;
}

// Find shortest walkable path from (startX,startY) to (destX,destY).
// Returns a smoothed [{x,y}] polyline, or null if no path exists.
export function findGridRoute(grid, startX, startY, destX, destY) {
  const { blocked, cols, rows, cellSize, forbiddenEdges } = grid;

  const toCell = (x, y) => ({
    c: Math.max(0, Math.min(cols - 1, Math.floor(x / cellSize))),
    r: Math.max(0, Math.min(rows - 1, Math.floor(y / cellSize))),
  });

  const sc = toCell(startX, startY);
  const dc = toCell(destX, destY);
  // Pass exitGapCells for start only: exit-gap cells have forbidden outbound edges
  // (exitGap → interior) that force A* outside the building when the origin is near an exit.
  // Also pass avoidExterior=true when the start cell is blocked (e.g. inside a large blocking
  // zone like a stage): without this the Chebyshev spiral reaches exterior walkable cells before
  // interior corridor cells, and A* then cannot re-enter the building through nearby exit-only
  // doors (exitGap → interior is forbidden), producing a null path instead of a valid route.
  // This mirrors the identical avoidExterior logic applied to the destination below.
  const startCellBlocked = !!blocked[sc.r * cols + sc.c];
  const start = nearestWalkable(blocked, cols, rows, sc.c, sc.r, grid.innerBboxes, cellSize, grid.exitGapCells, startCellBlocked);
  // Pass avoidExterior=true when the raw destination cell is blocked (e.g. inside a large
  // blocking zone or booth).  Without this, the Chebyshev spiral reaches exterior walkable
  // cells before interior corridor cells and snaps the destination outside the building,
  // forcing A* to route via the building exterior instead of through the interior.
  const destCellBlocked = !!blocked[dc.r * cols + dc.c];
  const end = nearestWalkable(blocked, cols, rows, dc.c, dc.r, grid.innerBboxes, cellSize, null, destCellBlocked);

  const gridPath = aStarGrid(blocked, cols, rows, start.c, start.r, end.c, end.r, forbiddenEdges);
  if (!gridPath) return null;

  // Convert cell indices to SVG coords (cell centers)
  const svgPath = gridPath.map(([c, r]) => ({ x: (c + 0.5) * cellSize, y: (r + 0.5) * cellSize }));

  // Prepend actual start and append actual dest for precise endpoints.
  // Tag each point with its raw-path index so the repair loop can look up
  // sub-paths in O(1) without relying on object-reference equality
  // (which would silently break if rdp() ever clones its input points).
  const full = [{ x: startX, y: startY }, ...svgPath, { x: destX, y: destY }];
  full.forEach((p, i) => { p._i = i; });

  // Simplify with RDP to remove grid-axis zigzag.
  let simplified = rdp(full, cellSize * 1.5);

  // Post-simplification wall-crossing repair.
  //
  // RDP can connect two waypoints A→B with a straight chord that visually
  // passes through a wall's interior even though the raw A* path correctly
  // routes around it (raw deviation < epsilon → RDP drops the intermediate
  // waypoints, but the chord crosses the wall).  For each simplified segment
  // that crosses any wall polyline, re-insert the original raw sub-path
  // between those two endpoints and repeat until the display line is clean.
  // Zones/outer-wall-ring don't need this because they mark cells blocked[],
  // so A* can never place waypoints straddling them.
  if (grid.walls?.length > 0) {
    const crossesWall = buildWallCrosser(grid.walls);

    let repaired = true;
    while (repaired) {
      repaired = false;
      const out = [simplified[0]];
      for (let i = 0; i < simplified.length - 1; i++) {
        const a = simplified[i], b = simplified[i + 1];
        if (crossesWall(a.x, a.y, b.x, b.y)) {
          const ia = a._i ?? -1;
          const ib = b._i ?? -1;
          if (ia !== -1 && ib !== -1 && ib > ia + 1) {
            // Re-insert raw sub-path between a and b (a is already in out).
            out.push(...full.slice(ia + 1, ib));
            repaired = true;
          }
        }
        out.push(b);
      }
      if (repaired) simplified = out;
    }

  }

  // Corridor-centering: nudge interior waypoints toward corridor/aisle
  // centers. Independent post-process -- comment out this one line to disable.
  // DISABLED 2026-08-25: even after the segmentBlocked fix, still cut through
  // a wall on the booth immediately after the destination per live testing.
  // Reverting to the plain A*/RDP-simplified path (pre-corridor-centering
  // behavior) rather than debugging further. centerPathInCorridors and
  // segmentBlocked are left intact below -- re-enable this line once the
  // underlying booth-blindness in crossesWall is properly fixed (see
  // project memory: iph-app RDP booth-crossing bug).
  // simplified = centerPathInCorridors(simplified, grid);

  // Strip the internal index tags before returning.
  for (const p of simplified) delete p._i;
  return simplified;
}
