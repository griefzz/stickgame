// Wire format. JSON with short keys; snapshots use positional arrays.
import type { PState } from "./player";
import { q3 } from "./player";

export const PROTOCOL = 2;

// Ball states
export const BS_NONE = 0;
export const BS_SERVE = 1;    // hovering at spawn, not hittable
export const BS_FLIGHT = 2;   // moving (straight line, or lob arc when lob flag set)
export const BS_HITSTOP = 4;  // frozen on the hitter's bat
export const BS_PENDING = 5;  // frozen on a victim while the server waits out lag grace
export const BS_GONE = 6;

// Player flags
export const PF_ALIVE = 1;
export const PF_FROZEN = 2;
export const PF_INVULN = 4;
export const PF_OUT = 8;
export const PF_GONE = 16;    // disconnected

// Match phases
export const PH_COUNTDOWN = 0;
export const PH_PLAY = 1;
export const PH_OVER = 2;

export type ClientMsg =
  | { t: "hi"; name: string; v: number }
  | { t: "name"; name: string }
  | { t: "q"; bots?: 0 | 1 }
  | { t: "bots"; on: 0 | 1 }
  | { t: "x" }
  | { t: "pr" }
  | { t: "lv" }
  | { t: "i"; d: [number, number, number, number, number, number] }
  | { t: "p"; c: number };

export interface RosterEntry { n: string; b: 0 | 1 }

export type ServerMsg =
  | { t: "w"; id: number; v: number; size: number; bf: number; b: string }
  | { t: "st"; on: number; q: number; m: number; b: string }
  | { t: "qs"; n: number; min: number; max: number; sIn: number; names: string[]; bf: number; bo: number }
  | { t: "go"; slot: number; roster: (RosterEntry | null)[]; st: number; cdEnd: number; practice: 0 | 1 }
  | { t: "s"; a: number; st: number; ph: number; p: (number[] | null)[]; b: number[] }
  | { t: "e"; k: string; st: number; [key: string]: unknown }
  | { t: "po"; c: number; s: number }
  | { t: "end"; r?: string }
  | { t: "err"; m: string };

export function encodeP(p: PState, flags: number, stocks: number): number[] {
  return [q3(p.x), q3(p.y), q3(p.z), q3(p.vx), q3(p.vy), q3(p.vz), q3(p.f), q3(p.ay), p.g, p.cd, p.sa, p.sk, flags, stocks, p.aj];
}

export function decodeP(a: number[], out: PState): PState {
  out.x = a[0]; out.y = a[1]; out.z = a[2];
  out.vx = a[3]; out.vy = a[4]; out.vz = a[5];
  out.f = a[6]; out.ay = a[7]; out.g = a[8];
  out.cd = a[9]; out.sa = a[10]; out.sk = a[11]; out.aj = a[14] ?? 0;
  return out;
}
export const P_FLAGS = 12;
export const P_STOCKS = 13;
export const P_AIRJ = 14;

// Ball snapshot: [state, x, y, z, vx, vy, vz, owner, speed, hits, timeLeft, lob, hitter]
export const B_STATE = 0, B_X = 1, B_Y = 2, B_Z = 3, B_VX = 4, B_VY = 5, B_VZ = 6,
  B_OWNER = 7, B_SPEED = 8, B_HITS = 9, B_LEFT = 10, B_LOB = 11, B_HITTER = 12;

export function cleanName(raw: unknown): string {
  let s = typeof raw === "string" ? raw : "";
  s = s.normalize("NFKC").replace(/[^\p{L}\p{N} _.\-!?]/gu, "").replace(/\s+/g, " ").trim();
  if (s.length > 14) s = s.slice(0, 14).trim();
  return s;
}
