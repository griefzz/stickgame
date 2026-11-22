// Arena shapes. Every arena is 12 m tall with a flat floor and ceiling; what changes is
// the floor plan. Polygons are defined by their corners (walls are derived from the
// edges); the circle is a true circle for physics and a fine polygon for drawing.
//
// Convex arenas collide against each wall's infinite line, which is exact and cheap.
// Non-convex arenas (star, plus, bowtie) collide against wall segments instead, with
// the inward-pointing corners treated as round posts.
import { HX, HZ, SPAWNS } from "./constants";

export interface Wall {
  nx: number; nz: number;   // outward unit normal
  d: number;                // distance from the centre to the wall's line along the normal
  ax: number; az: number;   // edge start
  bx: number; bz: number;   // edge end
  reflex: boolean;          // the start corner points into the arena (non-convex shapes)
}

export type ArenaKey = "box" | "octagon" | "pentagon" | "circle" | "star" | "plus" | "bowtie" | "triangle";

export interface Arena {
  key: ArenaKey;
  name: string;
  radius: number;           // > 0 for the circle
  convex: boolean;
  walls: Wall[];            // polygon walls (for the circle: a 48-sided outline, drawing only)
  verts: [number, number][];
  hx: number; hz: number;   // half extents of the bounding box
  reach: number;            // furthest corner from the centre
}

function fromVerts(key: ArenaKey, name: string, verts: [number, number][], radius = 0): Arena {
  const n = verts.length;
  // Wind counter-clockwise in (x, -z) so "left of the edge" is inside... we just need a
  // consistent orientation to tell reflex corners apart.
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
    let nx = tz / tl, nz = -tx / tl;
    // Every arena is star-shaped around the centre, so outward normals face away from it.
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    const [px, pz] = verts[(i - 1 + n) % n];
    const cross = (ax - px) * (bz - az) - (az - pz) * (bx - ax);
    const reflex = cross * sign < -1e-9;
    if (reflex) convex = false;
    walls.push({ nx, nz, d: nx * ax + nz * az, ax, az, bx, bz, reflex });
  }
  let hx = 0, hz = 0, reach = 0;
  for (const [x, z] of verts) { hx = Math.max(hx, Math.abs(x)); hz = Math.max(hz, Math.abs(z)); reach = Math.max(reach, Math.hypot(x, z)); }
  return { key, name, radius, convex: convex || radius > 0, walls, verts, hx, hz, reach };
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

function circle(radius: number): Arena {
  const a = regular("circle", "Circle", 48, radius);
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
  regular("pentagon", "Pentagon", 5, 12.5),
  circle(13.5),
  star(5, 16, 9),
  fromVerts("plus", "Plus", [
    [-6, -15], [6, -15], [6, -6], [15, -6], [15, 6], [6, 6],
    [6, 15], [-6, 15], [-6, 6], [-15, 6], [-15, -6], [-6, -6],
  ]),
  fromVerts("bowtie", "Bowtie", [[-15, -12], [15, -12], [3.5, 0], [15, 12], [-15, 12], [-3.5, 0]]),
  regular("triangle", "Triangle", 3, 9.5),
];
export const arenaOf = (i: number | undefined): Arena => ARENAS[i ?? 0] ?? ARENAS[0];
export const arenaIndex = (key: string) => ARENAS.findIndex((a) => a.key === key);

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

/**
 * Calls fn for every wall the point is closer than `inset` to (or beyond): outward normal
 * and how far it must move back. For the circle the single "wall" is the tangent.
 */
export function eachPenetration(a: Arena, x: number, z: number, inset: number, fn: (nx: number, nz: number, over: number) => void) {
  if (a.radius > 0) {
    const r = Math.hypot(x, z);
    const over = r - (a.radius - inset);
    if (over > 0 && r > 1e-9) fn(x / r, z / r, over);
    return;
  }
  if (a.convex) {
    for (const w of a.walls) {
      const over = w.nx * x + w.nz * z - (w.d - inset);
      if (over > 0) fn(w.nx, w.nz, over);
    }
    return;
  }
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

/** Outward normal (summed, normalised) of walls within `reach` of the point, or null. */
export function wallContact(a: Arena, x: number, z: number, inset: number, reach: number): { nx: number; nz: number } | null {
  let sx = 0, sz = 0, any = false;
  eachPenetration(a, x, z, inset + reach, (nx, nz) => { sx += nx; sz += nz; any = true; });
  if (!any) return null;
  const l = Math.hypot(sx, sz) || 1;
  return { nx: sx / l, nz: sz / l };
}

/** The wall the point has gone furthest past (outward normal), or null. */
export function deepestPenetration(a: Arena, x: number, z: number, inset: number): { nx: number; nz: number; over: number } | null {
  let best: { nx: number; nz: number; over: number } | null = null;
  eachPenetration(a, x, z, inset, (nx, nz, over) => { if (!best || over > best.over) best = { nx, nz, over }; });
  return best;
}

/** Keeps a point inside the arena (shrunk by inset), killing outward velocity. */
export function constrain(a: Arena, p: { x: number; z: number; vx?: number; vz?: number }, inset: number) {
  // Sharp corners need a few rounds of pushing off alternate walls to settle.
  for (let pass = 0; pass < 12; pass++) {
    const w = deepestPenetration(a, p.x, p.z, inset);
    if (!w) return;
    p.x -= w.nx * w.over; p.z -= w.nz * w.over;
    if (p.vx !== undefined && p.vz !== undefined) {
      const vn = p.vx * w.nx + p.vz * w.nz;
      if (vn > 0) { p.vx -= vn * w.nx; p.vz -= vn * w.nz; }
    }
  }
}

export function inside(a: Arena, x: number, z: number, inset: number): boolean {
  if (!inPolygon(a, x, z)) return false;
  let ok = true;
  eachPenetration(a, x, z, inset, () => { ok = false; });
  return ok;
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
