import { DT, PLAYER, SWING, weaponOf } from "./constants";
import { arenaOf, constrain, wallContact } from "./arena";

// Everything the client needs to predict its own player, and the server needs
// to simulate it. Kept flat so it serialises to a short array.
export interface PState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  f: number;   // facing, radians; forward = (sin f, cos f) in x/z
  ay: number;  // aim pitch input, -1 (low) .. 1 (high)
  g: number;   // grounded 0/1
  cd: number;  // swing cooldown, ticks
  sa: number;  // ticks since swing started, -1 when not swinging
  sk: number;  // swing kind: 0 smash, 1 bunt
  aj: number;  // air jumps used since last touching the floor
  ax: number;  // curve input, -1 (left) .. 1 (right), relative to the shot
  ds: number;  // air dash ticks remaining (0 = not dashing)
  dc: number;  // air dash used this airtime 0/1
  wj: number;  // wall jumps used this airtime
  wp: number;  // weapon index (fixed for the match; not sent in snapshots)
  ar: number;  // arena index (fixed for the match; not sent in snapshots)
}

// Buttons bitmask carried by each input.
export const B_JUMP = 1;      // jump held
export const B_JUMP_P = 2;    // jump pressed this tick
export const B_SWING = 4;     // swing pressed this tick
export const B_BUNT = 8;      // bunt pressed this tick
export const B_DASH = 16;     // air dash pressed this tick
export const B_SWING_HELD = 32; // swing button held (charges a hit during your own freeze)
export const B_ALL = 63;

export interface Input {
  s: number;   // sequence number
  mx: number;  // world-space move, x
  mz: number;  // world-space move, z
  ay: number;  // aim pitch
  ax: number;  // curve
  b: number;   // buttons
  t: number;   // client's estimate of server time when sampled
}

export function newPState(x: number, z: number, wp = 0, ar = 0): PState {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, f: Math.atan2(-x, -z), ay: 0, g: 1, cd: 0, sa: -1, sk: 0, aj: 0, ax: 0, ds: 0, dc: 0, wj: 0, wp, ar };
}

export function copyP(dst: PState, src: PState): PState {
  dst.x = src.x; dst.y = src.y; dst.z = src.z;
  dst.vx = src.vx; dst.vy = src.vy; dst.vz = src.vz;
  dst.f = src.f; dst.ay = src.ay; dst.g = src.g;
  dst.cd = src.cd; dst.sa = src.sa; dst.sk = src.sk; dst.aj = src.aj;
  dst.ax = src.ax; dst.ds = src.ds; dst.dc = src.dc; dst.wj = src.wj; dst.wp = src.wp; dst.ar = src.ar;
  return dst;
}

const clamp1 = (v: number) => (!(v === v) ? 0 : v > 1 ? 1 : v < -1 ? -1 : v);

export function approachAngle(a: number, b: number, maxStep: number): number {
  let d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  if (d > maxStep) d = maxStep;
  else if (d < -maxStep) d = -maxStep;
  return a + d;
}


export const q3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Advance one player by one fixed tick. Deterministic: the client replays the
 * same inputs through this to predict, the server runs it authoritatively.
 * Returns 1 if a smash started this tick, 2 for a bunt, else 0.
 */
export function stepPlayer(p: PState, inp: Input, frozen: boolean): number {
  let mx = inp.mx, mz = inp.mz;
  if (!(mx === mx)) mx = 0; // NaN guard
  if (!(mz === mz)) mz = 0;
  const mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; }
  p.ay = clamp1(inp.ay);
  p.ax = clamp1(inp.ax);

  if (p.cd > 0) p.cd--;
  if (p.sa >= 0) { p.sa++; if (p.sa > 90) p.sa = -1; }

  if (mag > 0.2) {
    const target = Math.atan2(mx, mz);
    p.f = frozen ? target : approachAngle(p.f, target, PLAYER.turnRate * DT);
  }

  if (frozen) {
    // Hitstop: the hitter hangs in place (even mid-air) and can only aim.
    p.vx = 0; p.vz = 0; p.vy = 0; p.ds = 0;
    return 0;
  }

  // The wall the player is touching, if any (for wall jumps and wall slides).
  const arena = arenaOf(p.ar);
  const wall = wallContact(arena, p.x, p.z, PLAYER.wallMargin, PLAYER.wallReach); // outward normal, or null

  if (p.ds > 0) {
    // Mid-dash: hold the dash velocity, no gravity.
    p.ds--;
    p.vy = 0;
  } else {
    const tvx = mx * PLAYER.speed, tvz = mz * PLAYER.speed;
    const acc = (p.g ? PLAYER.accelGround : PLAYER.accelAir) * DT;
    let dvx = tvx - p.vx, dvz = tvz - p.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl > acc) { dvx *= acc / dl; dvz *= acc / dl; }
    p.vx += dvx; p.vz += dvz;

    if (inp.b & B_JUMP_P) {
      if (p.g) { p.vy = PLAYER.jumpV; p.g = 0; }
      else if (wall && p.wj < PLAYER.wallJumps) {
        // Wall jump: kick away from the wall; restores the air jump and dash.
        const vn = p.vx * wall.nx + p.vz * wall.nz;
        p.vx -= (vn + PLAYER.wallKick) * wall.nx;
        p.vz -= (vn + PLAYER.wallKick) * wall.nz;
        p.vy = PLAYER.wallJumpV;
        p.wj++; p.aj = 0; p.dc = 0;
      } else if (p.aj < PLAYER.airJumps) { p.vy = PLAYER.airJumpV; p.aj++; }
    }

    if ((inp.b & B_DASH) && !p.g && !p.dc) {
      let dx = mx, dz = mz, dm = mag;
      if (dm < 0.2) { dx = Math.sin(p.f); dz = Math.cos(p.f); dm = 1; }
      p.vx = (dx / dm) * PLAYER.dashSpeed;
      p.vz = (dz / dm) * PLAYER.dashSpeed;
      p.vy = 0;
      p.ds = PLAYER.dashTicks - 1;
      p.dc = 1;
    } else {
      const rising = p.vy > 0;
      const grav = PLAYER.gravity * (rising && !(inp.b & B_JUMP) ? PLAYER.lowJumpMul : 1);
      p.vy -= grav * DT;
      // Wall slide: falling while pushing into a wall slows the fall.
      if (!p.g && p.vy < -PLAYER.wallSlide && wall && mx * wall.nx + mz * wall.nz > 0.3) p.vy = -PLAYER.wallSlide;
    }
  }
  p.y += p.vy * DT;
  if (p.y <= 0) { p.y = 0; p.vy = 0; p.g = 1; p.aj = 0; p.dc = 0; p.wj = 0; } else p.g = 0;

  p.x += p.vx * DT;
  p.z += p.vz * DT;
  constrain(arena, p, PLAYER.wallMargin);

  if ((inp.b & (B_SWING | B_BUNT)) && p.cd <= 0) {
    const bunt = !(inp.b & B_SWING);
    p.cd = weaponOf(p.wp).recover;
    p.sa = 0;
    p.sk = bunt ? 1 : 0;
    return bunt ? 2 : 1;
  }
  return 0;
}

/** Hitbox sphere centre for a player (feet position + facing). */
export function hitCentre(p: { x: number; y: number; z: number; f: number }, out: { x: number; y: number; z: number }) {
  out.x = p.x + Math.sin(p.f) * SWING.hitFwd;
  out.y = p.y + SWING.hitUp;
  out.z = p.z + Math.cos(p.f) * SWING.hitFwd;
  return out;
}

/** Squared distance from a point to a player's vertical hurtbox segment. */
export function hurtDist2(p: { x: number; y: number; z: number }, x: number, y: number, z: number): number {
  const lo = p.y + PLAYER.bodyLo, hi = p.y + PLAYER.bodyHi;
  const cy = y < lo ? lo : y > hi ? hi : y;
  const dx = x - p.x, dy = y - cy, dz = z - p.z;
  return dx * dx + dy * dy + dz * dz;
}
