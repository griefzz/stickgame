import { DT, HX, HZ, PLAYER, SWING } from "./constants";

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
}

// Buttons bitmask carried by each input.
export const B_JUMP = 1;      // jump held
export const B_JUMP_P = 2;    // jump pressed this tick
export const B_SWING = 4;     // swing pressed this tick
export const B_BUNT = 8;      // bunt pressed this tick

export interface Input {
  s: number;   // sequence number
  mx: number;  // world-space move, x
  mz: number;  // world-space move, z
  ay: number;  // aim pitch
  b: number;   // buttons
  t: number;   // client's estimate of server time when sampled
}

export function newPState(x: number, z: number): PState {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, f: Math.atan2(-x, -z), ay: 0, g: 1, cd: 0, sa: -1, sk: 0, aj: 0 };
}

export function copyP(dst: PState, src: PState): PState {
  dst.x = src.x; dst.y = src.y; dst.z = src.z;
  dst.vx = src.vx; dst.vy = src.vy; dst.vz = src.vz;
  dst.f = src.f; dst.ay = src.ay; dst.g = src.g;
  dst.cd = src.cd; dst.sa = src.sa; dst.sk = src.sk; dst.aj = src.aj;
  return dst;
}

export function approachAngle(a: number, b: number, maxStep: number): number {
  let d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  if (d > maxStep) d = maxStep;
  else if (d < -maxStep) d = -maxStep;
  return a + d;
}

const XMAX = HX - PLAYER.wallMargin;
const ZMAX = HZ - PLAYER.wallMargin;

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
  let ay = inp.ay;
  if (!(ay === ay)) ay = 0;
  p.ay = ay > 1 ? 1 : ay < -1 ? -1 : ay;

  if (p.cd > 0) p.cd--;
  if (p.sa >= 0) { p.sa++; if (p.sa > 90) p.sa = -1; }

  if (mag > 0.2) {
    const target = Math.atan2(mx, mz);
    p.f = frozen ? target : approachAngle(p.f, target, PLAYER.turnRate * DT);
  }

  if (frozen) {
    // Hitstop: the hitter hangs in place (even mid-air) and can only aim.
    p.vx = 0; p.vz = 0; p.vy = 0;
    return 0;
  }

  const tvx = mx * PLAYER.speed, tvz = mz * PLAYER.speed;
  const acc = (p.g ? PLAYER.accelGround : PLAYER.accelAir) * DT;
  let dvx = tvx - p.vx, dvz = tvz - p.vz;
  const dl = Math.hypot(dvx, dvz);
  if (dl > acc) { dvx *= acc / dl; dvz *= acc / dl; }
  p.vx += dvx; p.vz += dvz;

  if (inp.b & B_JUMP_P) {
    if (p.g) { p.vy = PLAYER.jumpV; p.g = 0; }
    else if (p.aj < PLAYER.airJumps) { p.vy = PLAYER.airJumpV; p.aj++; }
  }
  const rising = p.vy > 0;
  const grav = PLAYER.gravity * (rising && !(inp.b & B_JUMP) ? PLAYER.lowJumpMul : 1);
  p.vy -= grav * DT;
  p.y += p.vy * DT;
  if (p.y <= 0) { p.y = 0; p.vy = 0; p.g = 1; p.aj = 0; } else p.g = 0;

  p.x += p.vx * DT;
  p.z += p.vz * DT;
  if (p.x > XMAX) { p.x = XMAX; if (p.vx > 0) p.vx = 0; }
  else if (p.x < -XMAX) { p.x = -XMAX; if (p.vx < 0) p.vx = 0; }
  if (p.z > ZMAX) { p.z = ZMAX; if (p.vz > 0) p.vz = 0; }
  else if (p.z < -ZMAX) { p.z = -ZMAX; if (p.vz < 0) p.vz = 0; }

  if ((inp.b & (B_SWING | B_BUNT)) && p.cd <= 0) {
    const bunt = !(inp.b & B_SWING);
    p.cd = SWING.recoverTicks;
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
