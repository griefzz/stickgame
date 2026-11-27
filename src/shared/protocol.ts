// Wire format. JSON with short keys; snapshots use positional arrays.
import type { PState } from "./player";
import { q3 } from "./player";

export const PROTOCOL = 6;

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
  | { t: "hi"; name: string; v: number; w?: number }
  | { t: "wp"; w: number }             // weapon choice
  | { t: "name"; name: string }
  | { t: "q"; bots?: 0 | 1 }
  | { t: "bots"; on: 0 | 1 }
  | { t: "x" }
  | { t: "pr" }
  | { t: "lv" }
  | { t: "i"; d: [number, number, number, number, number, number, number] } // seq, mx, mz, ay, buttons, t, ax
  | { t: "p"; c: number }
  | { t: "rc" }                       // create a private room
  | { t: "rj"; code: string }         // join a room by code
  | { t: "rl" }                       // leave the room
  | { t: "rb"; on: 0 | 1 }            // host: let bots fill empty seats
  | { t: "rs" }                       // host: start the match
  | { t: "ra"; a: number }            // host: arena (-1 = random)
  | { t: "tr"; a: number }            // start training in this arena
  | { t: "tra"; a: number }           // training: switch to this arena
  | { t: "trr" };                     // training: reset the player and the ball

export interface RosterEntry { n: string; b: 0 | 1; w: number } // name, bot, weapon

/** Private room state, sent to every member on any change. */
export interface RoomState {
  t: "rm";
  code: string;
  host: 0 | 1;                         // you are the host
  bots: 0 | 1;                         // bots fill empty seats
  max: number;
  live: 0 | 1;                         // a match is running
  arena: number;                       // host's arena choice, -1 = random
  players: { n: string; h: 0 | 1; y: 0 | 1; p: 0 | 1 }[]; // name, host, you, playing now
}

export type ServerMsg =
  | { t: "w"; id: number; v: number; size: number; bf: number; b: string; ver: string }
  | { t: "st"; on: number; q: number; m: number; b: string }
  | { t: "qs"; n: number; min: number; max: number; sIn: number; names: string[]; bf: number; bo: number }
  | { t: "go"; slot: number; roster: (RosterEntry | null)[]; st: number; cdEnd: number; practice: 0 | 1; rm: string | null; ar: number; tr: 0 | 1 }
  | { t: "s"; a: number; st: number; ph: number; p: (number[] | null)[]; b: number[] }
  | { t: "e"; k: string; st: number; [key: string]: unknown }
  | { t: "po"; c: number; s: number }
  | { t: "end"; r?: string }
  | { t: "err"; m: string }
  | RoomState
  | { t: "rx" }                       // you left (or were removed from) the room
  | { t: "rerr"; m: string };

export function encodeP(p: PState, flags: number, stocks: number): number[] {
  return [q3(p.x), q3(p.y), q3(p.z), q3(p.vx), q3(p.vy), q3(p.vz), q3(p.f), q3(p.ay), p.g, p.cd, p.sa, p.sk, flags, stocks, p.aj, q3(p.ax), p.ds, p.dc, p.wj, q3(p.af)];
}

export function decodeP(a: number[], out: PState): PState {
  out.x = a[0]; out.y = a[1]; out.z = a[2];
  out.vx = a[3]; out.vy = a[4]; out.vz = a[5];
  out.f = a[6]; out.ay = a[7]; out.g = a[8];
  out.cd = a[9]; out.sa = a[10]; out.sk = a[11]; out.aj = a[14] ?? 0;
  out.ax = a[15] ?? 0; out.ds = a[16] ?? 0; out.dc = a[17] ?? 0; out.wj = a[18] ?? 0; out.af = a[19] ?? out.f;
  return out;
}
export const P_FLAGS = 12;
export const P_STOCKS = 13;
export const P_AIRJ = 14;
export const P_AX = 15;
export const P_DASH = 16;
export const P_WALLJ = 18;

// Ball snapshot: [state, x, y, z, vx, vy, vz, owner, speed, hits, timeLeft, lob, hitter, curve, curveTurnLeft, charge]
export const B_STATE = 0, B_X = 1, B_Y = 2, B_Z = 3, B_VX = 4, B_VY = 5, B_VZ = 6,
  B_OWNER = 7, B_SPEED = 8, B_HITS = 9, B_LEFT = 10, B_LOB = 11, B_HITTER = 12, B_CV = 13, B_CT = 14, B_CHG = 15;

export function cleanName(raw: unknown): string {
  let s = typeof raw === "string" ? raw : "";
  s = s.normalize("NFKC").replace(/[^\p{L}\p{N} _.\-!?]/gu, "").replace(/\s+/g, " ").trim();
  if (s.length > 14) s = s.slice(0, 14).trim();
  return s;
}
