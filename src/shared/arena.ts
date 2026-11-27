// Arena shapes. Most arenas are a floor plan extruded 12 m up: polygons are defined by
// their corners (walls derived from the edges), the circle is a true circle. On top of
// that an arena can have (no current arena uses these):
//   - blocks: solid full-height obstacles inside,
//   - a shell: a smooth 3D surface instead of flat floor + vertical walls. Players and the
//     ball collide with the shell in 3D, so running into a curve carries you up it.
//
// Convex floor plans collide against each wall's infinite line, which is exact and cheap.
// Non-convex ones (star, plus) collide against wall segments, with the
// inward-pointing corners treated as round posts.
import { BALL_SPAWN, HX, HY, HZ, SPAWNS } from "./constants";

export interface Wall {
  nx: number; nz: number;   // outward unit normal
  d: number;                // distance from the centre to the wall's line along the normal
  ax: number; az: number;   // edge start
  bx: number; bz: number;   // edge end
  reflex: boolean;          // the start corner points into the arena (non-convex shapes)
}

export type Block =
  | { kind: "rect"; x0: number; z0: number; x1: number; z1: number }
  | { kind: "circle"; x: number; z: number; r: number };

export type Shell =
  | { kind: "sphere"; cy: number; r: number }                                  // sphere cut by the floor
  | { kind: "roundbox"; hx: number; hy: number; hz: number; r: number };       // box with every edge rounded

export type ArenaKey = "box" | "octagon" | "circle" | "star" | "plus";

export interface Arena {
  key: ArenaKey;
  name: string;
  radius: number;           // > 0 for circular floor plans
  convex: boolean;
  walls: Wall[];            // floor-plan outline (for round shapes: a 48-sided outline)
  verts: [number, number][];
  hx: number; hz: number;   // half extents of the bounding box
  reach: number;            // furthest corner from the centre
  top: number;              // highest point of the inside
  blocks: Block[];
  shell: Shell | null;
  view: "arena" | "top";    // camera: the usual angled view, or straight down
}

function fromVerts(key: ArenaKey, name: string, verts: [number, number][], radius = 0): Arena {
  const n = verts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = verts[i], [bx, bz] = verts[(i + 1) % n];
    area += ax * bz - bx * az;
  }
  const sign = area > 0 ? 1 : -1;
  const walls: Wall[] = [];
  let convex = true;
  for (let i = 0; i < n; i++) {
    const [ax, az] = verts[i], [bx, bz] = verts[(i + 1) % n];
    const tx = bx - ax, tz = bz - az, tl = Math.hypot(tx, tz);
    // Outward normal from the winding (works for any simple polygon, not just star-shaped).
    const nx = (sign * tz) / tl, nz = (-sign * tx) / tl;
    const [px, pz] = verts[(i - 1 + n) % n];
    const cross = (ax - px) * (bz - az) - (az - pz) * (bx - ax);
    const reflex = cross * sign < -1e-9;
    if (reflex) convex = false;
    walls.push({ nx, nz, d: nx * ax + nz * az, ax, az, bx, bz, reflex });
  }
  let hx = 0, hz = 0, reach = 0;
  for (const [x, z] of verts) { hx = Math.max(hx, Math.abs(x)); hz = Math.max(hz, Math.abs(z)); reach = Math.max(reach, Math.hypot(x, z)); }
  return { key, name, radius, convex: convex || radius > 0, walls, verts, hx, hz, reach, top: HY, blocks: [], shell: null, view: "arena" };
}

/** Regular polygon with the given apothem (centre-to-wall distance), a flat wall facing +z. */
function regular(key: ArenaKey, name: string, n: number, apothem: number): Arena {
  const R = apothem / Math.cos(Math.PI / n);
  const verts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = (k * 2 * Math.PI) / n + Math.PI / n;
    verts.push([R * Math.sin(a), R * Math.cos(a)]);
  }
  return fromVerts(key, name, verts);
}

function circle(radius: number, key: ArenaKey = "circle", name = "Circle"): Arena {
  const a = regular(key, name, 48, radius);
  a.radius = radius;
  a.hx = a.hz = a.reach = radius;
  return a;
}

/** n-pointed star, one point aimed at the back wall (-z). */
function star(points: number, outer: number, inner: number): Arena {
  const verts: [number, number][] = [];
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 ? inner : outer;
    const a = Math.PI + (k * Math.PI) / points;
    verts.push([r * Math.sin(a), r * Math.cos(a)]);
  }
  return fromVerts("star", "Star", verts);
}

export const ARENAS: readonly Arena[] = [
  fromVerts("box", "Box", [[-HX, -HZ], [HX, -HZ], [HX, HZ], [-HX, HZ]]),
  regular("octagon", "Octagon", 8, 13),
  circle(13.5),
  star(5, 16, 9),
  fromVerts("plus", "Plus", [
    [-6, -15], [6, -15], [6, -6], [15, -6], [15, 6], [6, 6],
    [6, 15], [-6, 15], [-6, 6], [-15, 6], [-15, -6], [-6, -6],
  ]),
];
export const arenaOf = (i: number | undefined): Arena => ARENAS[i ?? 0] ?? ARENAS[0];
export const arenaIndex = (key: string) => ARENAS.findIndex((a) => a.key === key);
/** Height the ball is served from (under the ceiling in low arenas). */
export const serveY = (a: Arena) => Math.min(BALL_SPAWN.y, a.top - 1.6);

// ---------------------------------------------------------------- 3D shells

let gx = 0, gy = 0, gz = 0;
/** Signed distance to the shell surface (negative inside); outward gradient left in gx/gy/gz. */
export function shellDist(s: Shell, x: number, y: number, z: number): number {
  if (s.kind === "sphere") {
    const dy = y - s.cy, d = Math.hypot(x, dy, z);
    const fs = d - s.r, ff = -y;
    if (fs >= ff) { const k = d > 1e-9 ? 1 / d : 0; gx = x * k; gy = dy * k; gz = z * k; return fs; }
    gx = 0; gy = -1; gz = 0;
    return ff;
  }
  const py = y - s.hy;
  const qx = Math.abs(x) - (s.hx - s.r), qy = Math.abs(py) - (s.hy - s.r), qz = Math.abs(z) - (s.hz - s.r);
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  const outer = Math.hypot(mx, my, mz);
  if (outer > 1e-9) {
    gx = (mx / outer) * Math.sign(x); gy = (my / outer) * Math.sign(py); gz = (mz / outer) * Math.sign(z);
    return outer - s.r;
  }
  // Deep inside the core box: the nearest face wins.
  const m = Math.max(qx, qy, qz);
  gx = gy = gz = 0;
  if (m === qx) gx = Math.sign(x) || 1; else if (m === qy) gy = Math.sign(py) || 1; else gz = Math.sign(z) || 1;
  return m - s.r;
}
export const shellGrad = () => ({ x: gx, y: gy, z: gz });

/**
 * Keeps a sphere of radius r (centre x,y,z) inside the shell. Returns the push applied and
 * the outward normal of the deepest contact, or null if it was already inside.
 */
export function shellPush(s: Shell, c: { x: number; y: number; z: number }, r: number): { nx: number; ny: number; nz: number } | null {
  let hit: { nx: number; ny: number; nz: number } | null = null;
  for (let pass = 0; pass < 4; pass++) {
    const f = shellDist(s, c.x, c.y, c.z);
    const over = f + r;
    if (over <= 0) break;
    c.x -= gx * over; c.y -= gy * over; c.z -= gz * over;
    if (!hit) hit = { nx: gx, ny: gy, nz: gz };
  }
  return hit;
}

/**
 * Shell walls only: 2D signed distance to the shell's horizontal cross-section at height y
 * (so the floor and ceiling don't count). Outward horizontal normal left in gx/gz.
 */
function sliceDist(s: Shell, x: number, y: number, z: number): number {
  gy = 0;
  if (s.kind === "sphere") {
    const dy = y - s.cy, rs = Math.sqrt(Math.max(0, s.r * s.r - dy * dy)), d = Math.hypot(x, z);
    if (d > 1e-9) { gx = x / d; gz = z / d; } else { gx = 1; gz = 0; }
    return d - rs;
  }
  const my = Math.max(Math.abs(y - s.hy) - (s.hy - s.r), 0);
  const rs = Math.sqrt(Math.max(0, s.r * s.r - my * my));
  const qx = Math.abs(x) - (s.hx - s.r), qz = Math.abs(z) - (s.hz - s.r);
  if (qx > 0 || qz > 0) {
    const mx = Math.max(qx, 0), mz = Math.max(qz, 0), l = Math.hypot(mx, mz);
    gx = (mx / l) * (Math.sign(x) || 1); gz = (mz / l) * (Math.sign(z) || 1);
    return l - rs;
  }
  if (qx > qz) { gx = Math.sign(x) || 1; gz = 0; return qx - rs; }
  gx = 0; gz = Math.sign(z) || 1;
  return qz - rs;
}

// ---------------------------------------------------------------- 2D floor-plan queries

/** Even-odd point-in-polygon test on the arena outline. */
function inPolygon(a: Arena, x: number, z: number): boolean {
  if (a.radius > 0) return Math.hypot(x, z) < a.radius;
  let inside = false;
  const v = a.verts;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, zi] = v[i], [xj, zj] = v[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Deepest step a ball or player can take in one substep/tick, so a wall's segment check
// only counts points that really came from inside near it.
const MAX_STEP = 1.5;

function blockPenetrations(a: Arena, x: number, z: number, inset: number, fn: (nx: number, nz: number, over: number) => void) {
  for (const b of a.blocks) {
    if (b.kind === "circle") {
      const vx = x - b.x, vz = z - b.z, d = Math.hypot(vx, vz);
      if (d < b.r + inset && d > 1e-9) fn(-vx / d, -vz / d, b.r + inset - d);
      continue;
    }
    const cx = Math.max(b.x0, Math.min(b.x1, x)), cz = Math.max(b.z0, Math.min(b.z1, z));
    const vx = x - cx, vz = z - cz, d = Math.hypot(vx, vz);
    if (d > 1e-9) {
      if (d < inset) fn(-vx / d, -vz / d, inset - d);
    } else {
      // Inside the block: out through the nearest face.
      const l = x - b.x0, r = b.x1 - x, t = z - b.z0, bo = b.z1 - z, m = Math.min(l, r, t, bo);
      if (m === l) fn(1, 0, l + inset); else if (m === r) fn(-1, 0, r + inset);
      else if (m === t) fn(0, 1, t + inset); else fn(0, -1, bo + inset);
    }
  }
}

/**
 * Calls fn for every wall the point is closer than `inset` to (or beyond): outward normal
 * and how far it must move back. y matters for shell arenas (their walls curve with height).
 */
export function eachPenetration(a: Arena, x: number, z: number, inset: number, fn: (nx: number, nz: number, over: number) => void, y = 1) {
  if (a.shell) {
    const f = sliceDist(a.shell, x, y, z);
    if (f > -inset) fn(gx, gz, f + inset);
  } else if (a.radius > 0) {
    const r = Math.hypot(x, z);
    const over = r - (a.radius - inset);
    if (over > 0 && r > 1e-9) fn(x / r, z / r, over);
  } else if (a.convex) {
    for (const w of a.walls) {
      const over = w.nx * x + w.nz * z - (w.d - inset);
      if (over > 0) fn(w.nx, w.nz, over);
    }
  } else {
    let any = false;
    for (const w of a.walls) {
      const ex = w.bx - w.ax, ez = w.bz - w.az;
      const t = ((x - w.ax) * ex + (z - w.az) * ez) / (ex * ex + ez * ez);
      if (t > 0 && t < 1) {
        // Alongside the segment: signed distance from its line (positive = outside).
        const sd = w.nx * (x - w.ax) + w.nz * (z - w.az);
        if (sd > -inset && sd < MAX_STEP) { fn(w.nx, w.nz, sd + inset); any = true; }
      } else if (t <= 0 && w.reflex) {
        // An inward-pointing corner: a round post.
        const vx = x - w.ax, vz = z - w.az, dd = Math.hypot(vx, vz);
        if (dd < inset && dd > 1e-9 && inPolygon(a, x, z)) { fn(-vx / dd, -vz / dd, inset - dd); any = true; }
      }
    }
    // Escaped the outline altogether (shouldn't happen): pull back to the nearest wall.
    if (!any && !inPolygon(a, x, z)) {
      let best = Infinity, bnx = 0, bnz = 0;
      for (const w of a.walls) {
        const ex = w.bx - w.ax, ez = w.bz - w.az;
        const t = Math.max(0, Math.min(1, ((x - w.ax) * ex + (z - w.az) * ez) / (ex * ex + ez * ez)));
        const d = Math.hypot(x - (w.ax + ex * t), z - (w.az + ez * t));
        if (d < best) { best = d; bnx = w.nx; bnz = w.nz; }
      }
      fn(bnx, bnz, best + inset);
    }
  }
  if (a.blocks.length) blockPenetrations(a, x, z, inset, fn);
}

/** Outward normal (summed, normalised) of walls within `reach` of the point, or null. */
export function wallContact(a: Arena, x: number, z: number, inset: number, reach: number, y = 1): { nx: number; nz: number } | null {
  let sx = 0, sz = 0, any = false;
  eachPenetration(a, x, z, inset + reach, (nx, nz) => { sx += nx; sz += nz; any = true; }, y);
  if (!any) return null;
  const l = Math.hypot(sx, sz) || 1;
  return { nx: sx / l, nz: sz / l };
}

/** The wall the point has gone furthest past (outward normal), or null. */
export function deepestPenetration(a: Arena, x: number, z: number, inset: number, y = 1): { nx: number; nz: number; over: number } | null {
  let best: { nx: number; nz: number; over: number } | null = null;
  eachPenetration(a, x, z, inset, (nx, nz, over) => { if (!best || over > best.over) best = { nx, nz, over }; }, y);
  return best;
}

/** Keeps a point inside the arena (shrunk by inset), killing outward velocity. */
export function constrain(a: Arena, p: { x: number; z: number; vx?: number; vz?: number }, inset: number, y = 1) {
  // Sharp corners need a few rounds of pushing off alternate walls to settle.
  for (let pass = 0; pass < 12; pass++) {
    const w = deepestPenetration(a, p.x, p.z, inset, y);
    if (!w) return;
    p.x -= w.nx * w.over; p.z -= w.nz * w.over;
    if (p.vx !== undefined && p.vz !== undefined) {
      const vn = p.vx * w.nx + p.vz * w.nz;
      if (vn > 0) { p.vx -= vn * w.nx; p.vz -= vn * w.nz; }
    }
  }
}

export function inside(a: Arena, x: number, z: number, inset: number, y = 1): boolean {
  if (!a.shell && !inPolygon(a, x, z)) return false;
  let ok = true;
  eachPenetration(a, x, z, inset, () => { ok = false; }, y);
  return ok;
}

/** Is a ball of radius r at (x, y, z) fully inside (walls, blocks, floor, ceiling, shell)? */
export function containsBall(a: Arena, x: number, y: number, z: number, r: number): boolean {
  if (a.shell) return shellDist(a.shell, x, y, z) <= -r + 1e-6 && inside(a, x, z, r - 1e-6, y);
  return y >= r - 1e-6 && y <= a.top - r + 1e-6 && inside(a, x, z, r - 1e-6);
}

/** Uniform random point inside the arena (shrunk by inset). */
export function randomPoint(a: Arena, inset: number, rnd: () => number = Math.random): { x: number; z: number } {
  for (let i = 0; i < 400; i++) {
    const x = (rnd() * 2 - 1) * a.hx, z = (rnd() * 2 - 1) * a.hz;
    if (inside(a, x, z, inset)) return { x, z };
  }
  return { x: 0, z: 0 };
}

/** Starting spot for seat i: the usual spawn, pulled in along its ray until it fits. */
export function spawnPoint(a: Arena, i: number): { x: number; z: number } {
  const s = SPAWNS[i % SPAWNS.length];
  const len = Math.hypot(s.x, s.z), ux = s.x / len, uz = s.z / len;
  for (let r = len; r > 0.5; r -= 0.25) if (inside(a, ux * r, uz * r, 2.2)) return { x: ux * r, z: uz * r };
  return randomPoint(a, 2.2);
}

/** Outline the crowd stands follow: the arena itself, or a ring around non-convex shapes. */
export function standOutline(a: Arena): Arena {
  if (a.convex) return a;
  const c = circle(a.reach + 1);
  return { ...c, key: a.key, name: a.name };
}
