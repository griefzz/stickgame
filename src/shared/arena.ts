// Arena shapes. Every arena is 12 m tall with a flat floor and ceiling; what changes is
// the floor plan. Polygons are defined by their corners (walls are derived from the
// edges); the circle is a true circle for physics and a fine polygon for drawing.
import { HX, HZ } from "./constants";

export interface Wall {
  nx: number; nz: number;   // outward unit normal
  d: number;                // distance from the centre to the wall along the normal
  ax: number; az: number;   // edge start
  bx: number; bz: number;   // edge end
}

export interface Arena {
  key: "box" | "octagon" | "pentagon" | "circle";
  name: string;
  radius: number;           // > 0 for the circle
  walls: Wall[];            // polygon walls (for the circle: a 48-sided outline, drawing only)
  verts: [number, number][];
  hx: number; hz: number;   // half extents of the bounding box
}

function fromVerts(key: Arena["key"], name: string, verts: [number, number][], radius = 0): Arena {
  const walls: Wall[] = [];
  for (let i = 0; i < verts.length; i++) {
    const [ax, az] = verts[i], [bx, bz] = verts[(i + 1) % verts.length];
    const tx = bx - ax, tz = bz - az, tl = Math.hypot(tx, tz);
    let nx = tz / tl, nz = -tx / tl;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    walls.push({ nx, nz, d: nx * ax + nz * az, ax, az, bx, bz });
  }
  let hx = 0, hz = 0;
  for (const [x, z] of verts) { hx = Math.max(hx, Math.abs(x)); hz = Math.max(hz, Math.abs(z)); }
  return { key, name, radius, walls, verts, hx, hz };
}

/** Regular polygon with the given apothem (centre-to-wall distance). rot 0 puts a flat wall facing +z. */
function regular(key: Arena["key"], name: string, n: number, apothem: number): Arena {
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
  a.hx = a.hz = radius;
  return a;
}

export const ARENAS: readonly Arena[] = [
  fromVerts("box", "Box", [[-HX, -HZ], [HX, -HZ], [HX, HZ], [-HX, HZ]]),
  regular("octagon", "Octagon", 8, 13),
  regular("pentagon", "Pentagon", 5, 12.5),
  circle(13.5),
];
export const arenaOf = (i: number | undefined): Arena => ARENAS[i ?? 0] ?? ARENAS[0];
export const arenaIndex = (key: string) => ARENAS.findIndex((a) => a.key === key);

/**
 * Calls fn for every wall the point is beyond (outward normal, how far past `inset`).
 * For the circle the single "wall" is the tangent at the point's angle.
 */
export function eachPenetration(a: Arena, x: number, z: number, inset: number, fn: (nx: number, nz: number, over: number) => void) {
  if (a.radius > 0) {
    const r = Math.hypot(x, z);
    const over = r - (a.radius - inset);
    if (over > 0 && r > 1e-9) fn(x / r, z / r, over);
    return;
  }
  for (const w of a.walls) {
    const over = w.nx * x + w.nz * z - (w.d - inset);
    if (over > 0) fn(w.nx, w.nz, over);
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

/** Keeps a point inside the arena (shrunk by inset), killing outward velocity. */
export function constrain(a: Arena, p: { x: number; z: number; vx?: number; vz?: number }, inset: number) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    eachPenetration(a, p.x, p.z, inset, (nx, nz, over) => {
      p.x -= nx * over; p.z -= nz * over;
      if (p.vx !== undefined && p.vz !== undefined) {
        const vn = p.vx * nx + p.vz * nz;
        if (vn > 0) { p.vx -= vn * nx; p.vz -= vn * nz; }
      }
      moved = true;
    });
    if (!moved) return;
  }
}

export function inside(a: Arena, x: number, z: number, inset: number): boolean {
  let ok = true;
  eachPenetration(a, x, z, inset, () => { ok = false; });
  return ok;
}

/** Uniform random point inside the arena (shrunk by inset). */
export function randomPoint(a: Arena, inset: number, rnd: () => number = Math.random): { x: number; z: number } {
  for (let i = 0; i < 200; i++) {
    const x = (rnd() * 2 - 1) * a.hx, z = (rnd() * 2 - 1) * a.hz;
    if (inside(a, x, z, inset)) return { x, z };
  }
  return { x: 0, z: 0 };
}
