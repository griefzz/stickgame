// Training mode on a fake clock: the ball can't K.O. you, each smash's timing is reported
// (perfect, good, too early, too late, miss), and reset and arena switching work.
// Usage: bun tools/training-check.ts
import { Match, type Conn, type Slot } from "../src/server/match";
import { BALL_R, DT, SPEED_NEUTRAL, SWING, weaponOf } from "../src/shared/constants";
import { B_SWING, hitCentre } from "../src/shared/player";
import { BS_FLIGHT, BS_SERVE } from "../src/shared/protocol";
import { ARENAS } from "../src/shared/arena";

let failed = 0;
function check(name: string, ok: boolean, info = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  " + info : ""}`);
}

type Ev = { k: string; [key: string]: any };
const events: Ev[] = [];
let goMsg: any = null;
const conn: Conn = {
  id: 1, name: "TRAINEE", rtt: 0, match: null, slot: -1, state: "menu", bots: false, weapon: 0, room: null, ctl: 0, ctlT: 0,
  send(s: string) { const m = JSON.parse(s); if (m.t === "e") events.push(m); else if (m.t === "go") goMsg = m; },
};

const m = new Match([{ conn, name: "TRAINEE", bot: false, w: 0 }], false, () => {}, null, 0, true);
const s = m.slots.find((x): x is Slot => !!x)!;
s.lastInput = Infinity; // the test feeds inputs itself, so the server never idle-steps this player
let t = m.t, seq = 0;
const still = () => ({ s: ++seq, mx: 0, mz: 0, ay: 0, ax: 0, b: 0, t });
/** One server tick, then this tick's input (a swing that started at swingAt, if given). */
function step(swingAt?: number) {
  t += DT;
  m.tick(t);
  if (swingAt === undefined) m.applyInput(s, still(), t);
  else m.applyInput(s, { ...still(), b: B_SWING, t: swingAt }, t);
}
const run = (sec: number) => { for (let i = 0; i < Math.round(sec / DT); i++) step(); };

check("training: one player and no bots", m.slots.filter(Boolean).length === 1 && goMsg?.tr === 1, `go.tr=${goMsg?.tr}`);
run(1.2);
check("training: play starts after a short countdown", events.some((e) => e.k === "fight"));

/** Starts the ball `dist` m in front of the player's bat, flying straight at it. Returns the
 *  time it will enter the bat's reach. */
function fireAtPlayer(speed: number, dist = 9): number {
  const c = hitCentre(s.p, { x: 0, y: 0, z: 0 });
  const dx = -Math.sin(s.p.f), dz = -Math.cos(s.p.f); // opposite the way the player faces
  const b = m.ball;
  b.st = BS_FLIGHT; b.epoch++; m.hist.length = 0;
  b.k.x = c.x - dx * dist; b.k.y = c.y; b.k.z = c.z - dz * dist;
  b.k.vx = dx * speed; b.k.vy = 0; b.k.vz = dz * speed; b.k.lob = false; b.k.cv = 0; b.k.ct = 0;
  b.owner = s.idx; b.speed = speed;
  const reach = SWING.hitR * weaponOf(s.weapon).reach + BALL_R;
  return t + (dist - reach) / speed;
}

/** Waits for the next timing event (up to 2 s). */
function nextTiming(): Ev | null {
  const from = events.length;
  for (let i = 0; i < 120; i++) {
    const e = events.slice(from).find((x) => x.k === "tm");
    if (e) return e;
    step();
  }
  return null;
}

/** Swings `lead` seconds before the ball arrives (negative = after), then returns the timing event. */
function swingWithLead(lead: number): Ev | null {
  m.trainingReset();
  run(0.6); // let the swing cooldown run out
  const arrive = fireAtPlayer(20);
  const at = arrive - lead;
  const from = events.length;
  while (t + DT < at) step();
  step(at);
  for (let i = 0; i < 120; i++) {
    const e = events.slice(from).find((x) => x.k === "tm");
    if (e) return e;
    step();
  }
  return null;
}

// Swing timings: lead is how long before the ball reached the bat the swing started.
{
  const e = swingWithLead(0.01);
  check("timing: a swing just before contact is perfect", e?.r === "pf" && e.ms <= 50, JSON.stringify(e));
}
{
  const e = swingWithLead(0.13);
  check("timing: a swing 130 ms before contact is good", e?.r === "ok" && e.ms > 100 && e.ms < 160, JSON.stringify(e));
}
{
  const e = swingWithLead(0.35);
  check("timing: a swing 350 ms before the ball arrives is too early", e?.r === "early" && e.ms > 320 && e.ms < 380, JSON.stringify(e));
}
{
  // The ball spends about 0.2 s inside the reach at 20 m/s; swing 0.1 s after it leaves.
  const reach = SWING.hitR * weaponOf(s.weapon).reach + BALL_R;
  const e = swingWithLead(-(2 * reach / 20 + 0.1));
  check("timing: a swing after the ball went past is too late", e?.r === "late" && e.ms > 70 && e.ms < 130, JSON.stringify(e));
}
{
  m.trainingReset();
  run(0.6);
  m.ball.st = BS_SERVE; m.ball.t1 = t + 10; // ball hangs at the spawn point
  step(t);
  const e = nextTiming();
  check("timing: a swing with the ball nowhere near is a miss", e?.r === "miss", JSON.stringify(e));
}

// Nothing K.O.s you: a ball owned by another seat flies straight through you, then you rally
// it once and stand still while it bounces around.
{
  m.trainingReset();
  run(0.6);
  fireAtPlayer(40);
  m.ball.owner = (s.idx + 1) % 4;
  run(2);
  check("training: a ball in another colour passes through you", !events.some((e) => e.k === "ko") && s.alive);
  m.trainingReset();
  run(0.6);
  const arrive = fireAtPlayer(25);
  while (t + DT < arrive) step();
  step(arrive);
  run(20);
  check("training: a long rally never ends the session", !events.some((e) => e.k === "ko") && s.alive && !m.ended, `rally ${m.ball.hits}, speed ${m.ball.speed.toFixed(0)}`);
}

// Reset: player back on the spawn point, a fresh neutral serve.
{
  s.p.x = 3; s.p.z = 3;
  const from = events.length;
  m.trainingReset();
  const ks = events.slice(from).map((e) => e.k);
  check("reset: respawns the player and serves a fresh ball", ks.includes("spawn") && ks.includes("serve") && m.ball.st === BS_SERVE && m.ball.speed === SPEED_NEUTRAL && s.p.x !== 3, ks.join(","));
}

// Arena switch: everything moves to the new arena.
{
  const want = ARENAS.findIndex((a) => a.key === "star");
  const from = events.length;
  m.trainingArena(want);
  const e = events.slice(from).find((x) => x.k === "arena");
  check("arena: switching moves the match, the player and the ball", e?.ar === want && m.arena === want && s.p.ar === want && m.ball.k.ar === want, JSON.stringify(e));
  run(3);
  check("arena: play carries on after a switch", !m.ended && m.ball.st === BS_FLIGHT);
}

process.exit(failed ? 1 : 0);
