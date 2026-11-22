// Gameplay constants shared by server and client. Units are metres and seconds.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

// Arena: a 30 x 20 x 12 box centred on the origin, floor at y = 0.
export const HX = 15;
export const HZ = 10;
export const HY = 12;

export const BALL_R = 0.34;
export const BALL_SPAWN = { x: 0, y: HY - 1.6, z: 0 };

// Ball bounds for the ball's centre.
export const BX0 = -HX + BALL_R, BX1 = HX - BALL_R;
export const BY0 = BALL_R, BY1 = HY - BALL_R;
export const BZ0 = -HZ + BALL_R, BZ1 = HZ - BALL_R;

// Speed only climbs. Every smash multiplies it; bounces never slow it.
export const SPEED_NEUTRAL = 15;   // drifting serve ball
export const SPEED_FIRST = 18;     // first smash off a neutral ball
export const SPEED_MAX = 165;
export const nextSpeed = (s: number) => Math.min(SPEED_MAX, s * 1.17 + 1.5);
// Freeze grows with speed: 0.05 s at the bottom, 0.8 s at the top.
export const hitstopFor = (s: number) => 0.05 + 0.75 * Math.pow(s / SPEED_MAX, 1.6);
// Displayed number is speed x 2 (the concept reel's convention).
export const displaySpeed = (s: number) => Math.round(s * 2);

// Bunt: a slow pop-up lob that keeps the stored speed and hurts nobody.
export const BUNT_HITSTOP = 0.1;
export const LOB_GRAVITY = 20;
export const LOB_UP = 12.5;
export const LOB_FWD = 3.4;

export const SERVE_HOVER = 1.2;      // ball hangs at the spawn point before drifting
export const STOCKS = 3;
export const KO_HOLD = 0.5;          // ball hangs on the victim before the burst
export const RESPAWN_DELAY = 3.0;
export const SERVE_DELAY = 3.6;
export const INVULN = 1.6;
export const COUNTDOWN = 3;
export const GAMEOVER_DELAY = 2.2;

export const PLAYER = {
  speed: 11,
  accelGround: 120,
  accelAir: 42,
  gravity: 34,
  jumpV: 13.6,
  airJumps: 1,           // double jump: one extra jump before landing
  airJumpV: 12.4,
  lowJumpMul: 1.9,       // extra gravity while rising with jump released
  radius: 0.45,          // hurtbox capsule radius
  bodyLo: 0.25,          // hurtbox capsule from y+bodyLo to y+bodyHi
  bodyHi: 2.05,
  wallMargin: 0.6,
  turnRate: 30,          // rad/s
  pushRadius: 1.4,
};

export const SWING = {
  act0: 0.0,             // active window, seconds after press
  act1: 0.2,
  recoverTicks: 25,      // ticks before you can swing again after a whiff
  postHitTicks: 6,       // cooldown after a release
  hitFwd: 0.7,           // hitbox sphere centre: forward and up from the feet
  hitUp: 1.3,
  hitR: 1.75,
  animDur: 0.26,         // visual swing length (concept reel's Fs)
};

// Lag compensation: how far back the server will look for a swing, and how long
// it waits on a ball that has touched a human before confirming the K.O.
export const MAX_REWIND = 0.2;
export const MAX_KO_GRACE = 0.15;

export const MAX_PLAYERS = 4;

export const SLOTS = [
  { tag: "VOLT", color: "#ffc23d", weapon: "hammer", label: "Breaker hammer", crest: "horns" },
  { tag: "KITE", color: "#38e0ff", weapon: "racket", label: "Arc racket", crest: "fin" },
  { tag: "NOVA", color: "#ff4fa8", weapon: "blade", label: "Rail staff", crest: "halo" },
  { tag: "MOSS", color: "#8cff5a", weapon: "plank", label: "Slab paddle", crest: "ridge" },
] as const;

export const SPAWNS = [
  { x: -8, z: -4 },
  { x: 8, z: -4 },
  { x: -7, z: 5 },
  { x: 7, z: 5 },
];

export const NAME_MAX = 14;
