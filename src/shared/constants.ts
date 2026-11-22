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
export const SPEED_MAX = 500;      // shows as 1000 on the speedometer
export const OVERCLOCK_SPEED = 165; // past 330 on the speedometer the HUD reads "OVERCLOCKED"
// Each smash adds a gain that tapers as the ball gets faster: +15% of the speed early on,
// easing to +3% near the cap (plus a flat 2), so the top end takes a long rally to reach.
export const speedGain = (s: number) => 2 + s * (0.15 - 0.12 * Math.min(1, s / SPEED_MAX));
export const nextSpeed = (s: number) => Math.min(SPEED_MAX, s + speedGain(s));
// Freeze grows steadily with speed: 0.05 s at the bottom, ~0.35 s at 330, ~0.95 s at 1000.
// The faster the ball, the more time everyone gets to read the telegraph and move.
export const hitstopFor = (s: number) => 0.05 + 0.9 * (s / SPEED_MAX);
// 0..1 intensity for visuals and sound. Curved so everyday speeds still hit hard and
// the effects keep escalating all the way to the cap.
export const speedFeel = (s: number) => Math.min(1, Math.pow(Math.max(0, s) / SPEED_MAX, 0.6));
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
  speed: 13.3,           // horizontal movement is 21% up on the first tuning (11 m/s run)
  accelGround: 145,
  accelAir: 51,
  gravity: 34,
  jumpV: 13.6,
  airJumps: 1,           // double jump: one extra jump before landing
  airJumpV: 12.4,
  wallJumps: 3,          // wall jumps allowed before landing (each restores the air jump and dash)
  wallJumpV: 13,
  wallKick: 11.5,        // speed away from the wall
  wallReach: 0.15,       // how close to a wall counts as touching it
  wallSlide: 4.5,        // max fall speed while pushing into a wall
  dashSpeed: 29,         // air dash: one per airtime
  dashTicks: 10,         // ~0.17 s of flat, gravity-free flight
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
  // Aiming during your own freeze: only within aimCone of where you faced at contact,
  // turning at aimTurn rad/s, so the aim line sweeps visibly instead of snapping.
  aimCone: Math.PI / 4,  // 45 degrees either side: a 90 degree window
  aimTurn: Math.PI,      // 180 degrees per second
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

// Perfect hit: the swing started at most `window` seconds before the ball met the bat.
// Rewards a late, risky swing with a bigger speed gain and a shorter freeze for opponents.
export const PERFECT = {
  window: 0.05,
  gainMul: 1.5,          // this hit's speed gain is 50% bigger
  freezeMul: 0.65,
};

// Charge: keep holding swing after you connect and the ball stays on your bat past the
// normal freeze, building up to double this hit's speed gain. Everyone else gets that time to react.
export const CHARGE = {
  maxHold: 0.9,          // seconds of extra hold for a full charge (weapons can change this)
  gainMul: 1,            // a full charge adds another 100% of this hit's speed gain
  labelAt: 0.15,         // charge needed for the "CHARGED" callout
};

// Weapons are picked on the title screen; colour still comes from the seat.
export interface Weapon {
  key: "hammer" | "racket" | "blade" | "plank";
  name: string;
  trait: string;
  desc: string;
  speedMul: number;      // multiplies the speed gained from each smash
  reach: number;         // hit zone radius multiplier
  recover: number;       // ticks before you can swing again after a miss
  perfect: number;       // perfect-hit window, seconds
  curve: number;         // curve tightness multiplier
  charge: number;        // seconds of hold for a full charge
}
export const WEAPONS: readonly Weapon[] = [
  { key: "hammer", name: "Breaker hammer", trait: "Power", desc: "Hits 12% harder. Slower to recover from a miss.", speedMul: 1.12, reach: 1, recover: 31, perfect: 0.05, curve: 1, charge: 0.9 },
  { key: "racket", name: "Arc racket", trait: "Reach", desc: "20% bigger hit zone. Hits 5% softer.", speedMul: 0.95, reach: 1.2, recover: 25, perfect: 0.05, curve: 1, charge: 0.9 },
  { key: "blade", name: "Rail staff", trait: "Timing", desc: "Easier perfect hits. Recovers fast from a miss.", speedMul: 1, reach: 1, recover: 17, perfect: 0.075, curve: 1, charge: 0.9 },
  { key: "plank", name: "Slab paddle", trait: "Spin", desc: "Curves bend 40% tighter. Charges twice as fast.", speedMul: 1, reach: 1, recover: 25, perfect: 0.05, curve: 1.4, charge: 0.45 },
];
export const weaponOf = (i: number | undefined): Weapon => WEAPONS[i ?? 0] ?? WEAPONS[0];
