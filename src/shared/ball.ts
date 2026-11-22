import { BX0, BX1, BY0, BY1, BZ0, BZ1, LOB_GRAVITY } from "./constants";

export interface BallKin {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  lob: boolean; // true: gravity + lossy bounces (bunt arc); false: straight line, perfect reflection
}

/** axis: 0 x, 1 y, 2 z. side: -1 low wall (normal +), +1 high wall (normal -). */
export type BounceFn = (axis: number, side: number, x: number, y: number, z: number, impact: number) => void;

export const SUBSTEP_LEN = 0.4;

export function substepsFor(b: BallKin, dt: number): number {
  const d = Math.hypot(b.vx, b.vy, b.vz) * dt;
  return Math.max(1, Math.min(24, Math.ceil(d / SUBSTEP_LEN)));
}

// Fold a coordinate back into [lo, hi], mirroring velocity on each crossing.
function foldLine(b: BallKin, axis: number, lo: number, hi: number, cb?: BounceFn) {
  let guard = 0;
  for (;;) {
    const p = axis === 0 ? b.x : axis === 1 ? b.y : b.z;
    let np: number, side: number;
    if (p < lo) { np = 2 * lo - p; side = -1; }
    else if (p > hi) { np = 2 * hi - p; side = 1; }
    else return;
    if (axis === 0) { b.x = np; b.vx = -b.vx; }
    else if (axis === 1) { b.y = np; b.vy = -b.vy; }
    else { b.z = np; b.vz = -b.vz; }
    if (cb) {
      const v = axis === 0 ? b.vx : axis === 1 ? b.vy : b.vz;
      cb(axis, side, b.x, b.y, b.z, Math.abs(v));
    }
    if (++guard > 8) {
      // Absurd speed for one step; clamp rather than loop.
      if (axis === 0) b.x = Math.min(hi, Math.max(lo, b.x));
      else if (axis === 1) b.y = Math.min(hi, Math.max(lo, b.y));
      else b.z = Math.min(hi, Math.max(lo, b.z));
      return;
    }
  }
}

function lobAxis(b: BallKin, axis: number, lo: number, hi: number, e: number, cb?: BounceFn) {
  const p = axis === 0 ? b.x : axis === 1 ? b.y : b.z;
  const v = axis === 0 ? b.vx : axis === 1 ? b.vy : b.vz;
  let side = 0, np = p;
  if (p < lo) { np = lo + (lo - p) * e; side = -1; }
  else if (p > hi) { np = hi - (p - hi) * e; side = 1; }
  if (!side) return;
  let nv = -v * e;
  const impact = Math.abs(v);
  if (axis === 1 && side === -1) {
    // Floor: lose some roll, and come to rest when the bounce dies out.
    b.vx *= 0.9; b.vz *= 0.9;
    if (Math.abs(nv) < 1.6) { nv = 0; np = lo; }
  }
  if (axis === 0) { b.x = np; b.vx = nv; }
  else if (axis === 1) { b.y = np; b.vy = nv; }
  else { b.z = np; b.vz = nv; }
  if (cb && impact > 2) cb(axis, side, b.x, b.y, b.z, impact);
}

/** Advance the ball by dt (call with small dt: one substep). */
export function advanceBall(b: BallKin, dt: number, cb?: BounceFn) {
  if (b.lob) {
    const resting = b.y <= BY0 + 1e-4 && b.vy === 0;
    if (resting) {
      const k = Math.exp(-1.5 * dt);
      b.vx *= k; b.vz *= k;
    } else {
      b.vy -= LOB_GRAVITY * dt;
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    lobAxis(b, 0, BX0, BX1, 0.85, cb);
    lobAxis(b, 1, BY0, BY1, 0.72, cb);
    lobAxis(b, 2, BZ0, BZ1, 0.85, cb);
    return;
  }
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  foldLine(b, 0, BX0, BX1, cb);
  foldLine(b, 1, BY0, BY1, cb);
  foldLine(b, 2, BZ0, BZ1, cb);
}

/** Advance by a full frame/tick using adequate substeps. */
export function advanceBallFull(b: BallKin, dt: number, cb?: BounceFn) {
  const n = substepsFor(b, dt);
  const h = dt / n;
  for (let i = 0; i < n; i++) advanceBall(b, h, cb);
}
