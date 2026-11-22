import { BALL_R, BY0, LOB_GRAVITY } from "./constants";
import { arenaOf, constrain, deepestPenetration, shellDist, shellGrad, type Arena, type Shell } from "./arena";

export interface BallKin {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  lob: boolean; // true: gravity + lossy bounces (bunt arc); false: straight line, perfect reflection
  cv: number;   // curve: signed curvature of the horizontal path (1/radius); 0 = straight
  ct: number;   // turn budget left for the curve, radians; spin also dies on the first bounce
  ar: number;   // arena index (walls come from the arena's shape)
}

export function newKin(ar = 0): BallKin {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lob: false, cv: 0, ct: 0, ar };
}

/** Called on every bounce with the surface's inward normal (the direction the ball leaves in). */
export type BounceFn = (nx: number, ny: number, nz: number, x: number, y: number, z: number, impact: number) => void;

export const SUBSTEP_LEN = 0.4;

export function substepsFor(b: BallKin, dt: number): number {
  const d = Math.hypot(b.vx, b.vy, b.vz) * dt;
  return Math.max(1, Math.min(24, Math.ceil(d / SUBSTEP_LEN)));
}

/** Side walls and blocks: reflect off whichever wall(s) the ball crossed. e = 1 for a perfect bounce. */
function walls(b: BallKin, a: Arena, e: number, cb?: BounceFn) {
  for (let pass = 0; pass < 4; pass++) {
    const w = deepestPenetration(a, b.x, b.z, BALL_R);
    if (!w) return;
    b.x -= (1 + e) * w.over * w.nx;
    b.z -= (1 + e) * w.over * w.nz;
    const vn = b.vx * w.nx + b.vz * w.nz;
    if (vn > 0) { b.vx -= (1 + e) * vn * w.nx; b.vz -= (1 + e) * vn * w.nz; }
    b.cv = 0; b.ct = 0; // spin dies on contact
    if (cb && (e === 1 || vn > 2)) cb(-w.nx, 0, -w.nz, b.x, b.y, b.z, Math.abs(vn));
  }
  // Absurd speed for one step: clamp rather than loop.
  constrain(a, b, BALL_R);
}

/** Curved 3D shells (sphere, slide): reflect off the surface normal in full 3D. */
function shellBounce(b: BallKin, s: Shell, e: number, cb?: BounceFn) {
  for (let pass = 0; pass < 4; pass++) {
    const over = shellDist(s, b.x, b.y, b.z) + BALL_R;
    if (over <= 0) return;
    const g = shellGrad();
    const vn = b.vx * g.x + b.vy * g.y + b.vz * g.z;
    if (e < 1 && g.y < -0.9 && vn < 1.6 / 0.72) {
      // Lob settling on the flat floor: stop bouncing, keep rolling.
      b.x -= over * g.x; b.y -= over * g.y; b.z -= over * g.z;
      b.vy = 0; b.y = BY0;
      b.vx *= 0.9; b.vz *= 0.9;
      continue;
    }
    b.x -= (1 + e) * over * g.x; b.y -= (1 + e) * over * g.y; b.z -= (1 + e) * over * g.z;
    if (vn > 0) { b.vx -= (1 + e) * vn * g.x; b.vy -= (1 + e) * vn * g.y; b.vz -= (1 + e) * vn * g.z; }
    if (e < 1 && g.y < -0.5) { b.vx *= 0.9; b.vz *= 0.9; }
    b.cv = 0; b.ct = 0;
    if (cb && (e === 1 || vn > 2)) cb(-g.x, -g.y, -g.z, b.x, b.y, b.z, Math.abs(vn));
  }
}

function floorCeilLine(b: BallKin, top: number, cb?: BounceFn) {
  const hi = top - BALL_R;
  for (let guard = 0; guard < 8; guard++) {
    let side: number;
    if (b.y < BY0) { b.y = 2 * BY0 - b.y; side = -1; }
    else if (b.y > hi) { b.y = 2 * hi - b.y; side = 1; }
    else return;
    b.vy = -b.vy;
    b.cv = 0; b.ct = 0;
    if (cb) cb(0, -side, 0, b.x, b.y, b.z, Math.abs(b.vy));
  }
  b.y = Math.min(hi, Math.max(BY0, b.y));
}

function floorCeilLob(b: BallKin, top: number, cb?: BounceFn) {
  const hi = top - BALL_R;
  const p = b.y, v = b.vy;
  let side = 0, np = p;
  if (p < BY0) { np = BY0 + (BY0 - p) * 0.72; side = -1; }
  else if (p > hi) { np = hi - (p - hi) * 0.72; side = 1; }
  if (!side) return;
  let nv = -v * 0.72;
  if (side === -1) {
    // Floor: lose some roll, and come to rest when the bounce dies out.
    b.vx *= 0.9; b.vz *= 0.9;
    if (Math.abs(nv) < 1.6) { nv = 0; np = BY0; }
  }
  b.y = np; b.vy = nv;
  if (cb && Math.abs(v) > 2) cb(0, -side, 0, b.x, b.y, b.z, Math.abs(v));
}

/** Advance the ball by dt (call with small dt: one substep). */
export function advanceBall(b: BallKin, dt: number, cb?: BounceFn) {
  const a = arenaOf(b.ar);
  if (b.lob) {
    const resting = b.y <= BY0 + 1e-4 && b.vy === 0;
    if (resting) {
      const k = Math.exp(-1.5 * dt);
      b.vx *= k; b.vz *= k;
    } else {
      b.vy -= LOB_GRAVITY * dt;
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (a.shell) shellBounce(b, a.shell, 0.72, cb);
    else { walls(b, a, 0.85, cb); floorCeilLob(b, a.top, cb); }
    return;
  }
  if (b.cv !== 0) {
    // Curve: turn the horizontal velocity by (curvature x distance travelled), so the
    // arc has the same shape at any speed. Stops once the turn budget is spent.
    let th = b.cv * Math.hypot(b.vx, b.vz) * dt;
    const ab = th < 0 ? -th : th;
    if (ab >= b.ct) { th = th < 0 ? -b.ct : b.ct; b.cv = 0; b.ct = 0; }
    else b.ct -= ab;
    const c = Math.cos(th), s = Math.sin(th);
    const vx = b.vx * c - b.vz * s;
    b.vz = b.vx * s + b.vz * c;
    b.vx = vx;
  }
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (a.shell) shellBounce(b, a.shell, 1, cb);
  else { walls(b, a, 1, cb); floorCeilLine(b, a.top, cb); }
}

/** Advance by a full frame/tick using adequate substeps. */
export function advanceBallFull(b: BallKin, dt: number, cb?: BounceFn) {
  const n = substepsFor(b, dt);
  const h = dt / n;
  for (let i = 0; i < n; i++) advanceBall(b, h, cb);
}
