// Grid-based A* pathfinding for exhibition map wayfinding.
// Booths are the only real obstacles; aisles between them remain walkable.
// Cell size = 20 SVG units ≈ 1.3 m (calibration: ~15 SVG units = 1 m).

const CELL = 20;
const SQRT2 = Math.SQRT2;

// ── Grid construction ──────────────────────────────────────────────────────────

// Builds a walkable grid from map dimensions and an array of booths.
// Marks any cell whose center falls strictly inside a booth's bounding box as blocked.
// Returns { blocked: Uint8Array, cols, rows, cellSize }.
export function buildWalkableGrid(mapW, mapH, allBooths, cellSize = CELL) {
  const cols = Math.ceil(mapW / cellSize) + 2;
  const rows = Math.ceil(mapH / cellSize) + 2;
  const blocked = new Uint8Array(cols * rows); // 0 = walkable, 1 = blocked

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
    // Cell c has center at (c + 0.5) * cellSize.
    // Block cell c if center is STRICTLY inside (minX, maxX):
    //   c > minX/cellSize − 0.5  →  c ≥ floor(minX/cellSize − 0.5) + 1
    //   c < maxX/cellSize − 0.5  →  c ≤ ceil(maxX/cellSize − 0.5) − 1
    const c0 = Math.max(0, Math.floor(minX / cellSize - 0.5) + 1);
    const c1 = Math.min(cols - 1, Math.ceil(maxX / cellSize - 0.5) - 1);
    const r0 = Math.max(0, Math.floor(minY / cellSize - 0.5) + 1);
    const r1 = Math.min(rows - 1, Math.ceil(maxY / cellSize - 0.5) - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        blocked[r * cols + c] = 1;
      }
    }
  }

  return { blocked, cols, rows, cellSize };
}

// ── Nearest walkable cell (Chebyshev spiral) ──────────────────────────────────

function nearestWalkable(blocked, cols, rows, c, r) {
  if (!blocked[r * cols + c]) return { c, r };
  for (let d = 1; d < Math.max(cols, rows); d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.abs(dr) !== d && Math.abs(dc) !== d) continue;
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !blocked[nr * cols + nc]) {
          return { c: nc, r: nr };
        }
      }
    }
  }
  return { c, r };
}

// ── 8-directional A* on the blocked grid ─────────────────────────────────────

const DIRS = [
  [0, 1, 1], [0, -1, 1], [1, 0, 1], [-1, 0, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

function aStarGrid(blocked, cols, rows, sc, sr, ec, er) {
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

    for (const [dc, dr, cost] of DIRS) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      if (blocked[nr * cols + nc]) continue;
      // Prevent diagonal corner-cutting through booth walls
      if (dc !== 0 && dr !== 0) {
        if (blocked[cr * cols + (cc + dc)]) continue;
        if (blocked[(cr + dr) * cols + cc]) continue;
      }
      const ni = nr * cols + nc;
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
  const { blocked, cols, rows, cellSize } = grid;

  const toCell = (x, y) => ({
    c: Math.max(0, Math.min(cols - 1, Math.floor(x / cellSize))),
    r: Math.max(0, Math.min(rows - 1, Math.floor(y / cellSize))),
  });

  const sc = toCell(startX, startY);
  const dc = toCell(destX, destY);
  const start = nearestWalkable(blocked, cols, rows, sc.c, sc.r);
  const end = nearestWalkable(blocked, cols, rows, dc.c, dc.r);

  const gridPath = aStarGrid(blocked, cols, rows, start.c, start.r, end.c, end.r);
  if (!gridPath) return null;

  // Convert cell indices to SVG coords (cell centers)
  const svgPath = gridPath.map(([c, r]) => ({ x: (c + 0.5) * cellSize, y: (r + 0.5) * cellSize }));

  // Prepend actual start and append actual dest for precise endpoints
  const full = [{ x: startX, y: startY }, ...svgPath, { x: destX, y: destY }];

  // Simplify with RDP at 1.5-cell tolerance to remove grid-axis zigzag
  return rdp(full, cellSize * 1.5);
}
