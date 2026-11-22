import {
  BALL_R, BALL_SPAWN, BUNT_HITSTOP, COUNTDOWN, DT, GAMEOVER_DELAY, HX, HZ, INVULN, KO_HOLD,
  LOB_FWD, LOB_UP, MAX_KO_GRACE, MAX_PLAYERS, MAX_REWIND, PLAYER, RESPAWN_DELAY, SERVE_DELAY,
  PERFECT, SERVE_HOVER, SPAWNS, SPEED_FIRST, SPEED_MAX, SPEED_NEUTRAL, STOCKS, SWING, hitstopFor, nextSpeed,
} from "../shared/constants";
import { advanceBall, substepsFor, type BallKin } from "../shared/ball";
import { B_ALL, hitCentre, hurtDist2, newPState, q3, stepPlayer, type Input, type PState } from "../shared/player";
import { shotDir } from "../shared/shot";
import {
  BS_FLIGHT, BS_GONE, BS_HITSTOP, BS_NONE, BS_PENDING, BS_SERVE, PF_ALIVE, PF_FROZEN, PF_GONE,
  PF_INVULN, PF_OUT, PH_COUNTDOWN, PH_OVER, PH_PLAY, encodeP, type RosterEntry,
} from "../shared/protocol";
import { Bot } from "./bot";

export interface Conn {
  id: number;
  name: string;
  rtt: number;               // seconds, as reported by the client
  send(s: string): void;
  match: Match | null;
  slot: number;
  state: "menu" | "queue" | "match";
  bots: boolean;             // player allows bots to fill empty seats
  ctl: number;               // token bucket for non-input messages
  ctlT: number;
}

export interface Slot {
  idx: number;
  name: string;
  conn: Conn | null;
  bot: Bot | null;
  p: PState;
  alive: boolean;
  stocks: number;
  out: boolean;
  gone: boolean;
  frozen: boolean;
  invulnUntil: number;
  elim: number;
  swing: { tP: number; kind: number; used: boolean } | null;
  lastSeq: number;
  tokens: number;
  tokenT: number;
  lastInput: number;   // wall time of the last input from this player
  lastActive: number;  // wall time of the last input that did anything (AFK check)
}

const IDLE_STEP_AFTER = 0.25;   // no input for this long: the server steps the player itself
const AFK_TIMEOUT = 75;         // seconds of doing nothing before a human is removed
const MATCH_TIME_LIMIT = 600;   // hard cap; the player with the most stocks wins

export interface BallState {
  st: number;
  k: BallKin;
  owner: number;
  hitter: number;
  speed: number;
  hits: number;
  epoch: number;
  t1: number;        // hitstop end / serve launch / pending confirm time
  bunt: boolean;
  perfect: boolean;
  pend: { victim: number; ct: number; dx: number; dy: number; dz: number } | null;
}

interface Hist { t: number; x: number; y: number; z: number; e: number }

const now = () => performance.now() / 1000;
let nextMatchId = 1;

export class Match {
  id = nextMatchId++;
  slots: (Slot | null)[] = [];
  phase = PH_COUNTDOWN;
  t = now();
  cdEnd: number;
  practice: boolean;
  ball: BallState;
  hist: Hist[] = [];
  timers: { t: number; fn: () => void }[] = [];
  elimCount = 0;
  ended = false;
  onEnd: (m: Match) => void;

  constructor(entrants: { conn: Conn | null; name: string; bot: boolean }[], practice: boolean, onEnd: (m: Match) => void) {
    this.practice = practice;
    this.onEnd = onEnd;
    this.cdEnd = this.t + COUNTDOWN + 0.6;
    // Random seats, so colours and spawn corners vary even in 2- and 3-player matches.
    const order = Array.from({ length: MAX_PLAYERS }, (_, i) => i).sort(() => Math.random() - 0.5);
    const bySlot: ({ conn: Conn | null; name: string; bot: boolean } | null)[] = Array(MAX_PLAYERS).fill(null);
    entrants.slice(0, MAX_PLAYERS).forEach((e, k) => { bySlot[order[k]] = e; });
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const e = bySlot[i];
      if (!e) { this.slots.push(null); continue; }
      const sp = SPAWNS[i];
      const s: Slot = {
        idx: i, name: e.name, conn: e.conn, bot: e.bot ? new Bot(i) : null,
        p: newPState(sp.x, sp.z), alive: true, stocks: STOCKS, out: false, gone: false, frozen: false,
        invulnUntil: 0, elim: 0, swing: null, lastSeq: 0, tokens: 20, tokenT: this.t,
        lastInput: this.t, lastActive: this.t,
      };
      this.slots.push(s);
      if (e.conn) { e.conn.match = this; e.conn.slot = i; e.conn.state = "match"; }
    }
    this.ball = {
      st: BS_NONE, k: { x: BALL_SPAWN.x, y: BALL_SPAWN.y, z: BALL_SPAWN.z, vx: 0, vy: 0, vz: 0, lob: false, cv: 0, ct: 0 },
      owner: -1, hitter: -1, speed: SPEED_NEUTRAL, hits: 0, epoch: 0, t1: 0, bunt: false, perfect: false, pend: null,
    };
    const roster: (RosterEntry | null)[] = this.slots.map((s) => (s ? { n: s.name, b: s.bot ? 1 : 0 } : null));
    for (const s of this.slots) {
      if (s?.conn) {
        s.conn.send(JSON.stringify({ t: "go", slot: s.idx, roster, st: q3(this.t), cdEnd: q3(this.cdEnd), practice: practice ? 1 : 0 }));
      }
    }
    this.after(this.cdEnd - this.t, () => {
      this.phase = PH_PLAY;
      this.event({ k: "fight" });
      this.serve();
    });
  }

  // ---------------------------------------------------------------- helpers

  after(dt: number, fn: () => void) { this.timers.push({ t: this.t + dt, fn }); }

  broadcast(msg: string) {
    for (const s of this.slots) if (s?.conn) s.conn.send(msg);
  }

  event(e: Record<string, unknown>) {
    this.broadcast(JSON.stringify({ t: "e", st: q3(this.t), ...e }));
  }

  humans(): Slot[] { return this.slots.filter((s): s is Slot => !!s && !!s.conn); }
  contenders(): Slot[] { return this.slots.filter((s): s is Slot => !!s && !s.out && !s.gone && s.stocks > 0); }

  // ---------------------------------------------------------------- input

  handleInput(conn: Conn, d: unknown) {
    const s = this.slots[conn.slot];
    if (!s || s.conn !== conn || !Array.isArray(d) || d.length < 6) return;
    const seq = +d[0];
    if (!(seq > s.lastSeq) || !Number.isFinite(seq)) return;
    const wall = now();
    // Token bucket: inputs may not arrive faster than the tick rate on average.
    s.tokens = Math.min(24, s.tokens + (wall - s.tokenT) * 60);
    s.tokenT = wall;
    if (s.tokens < 1) return;
    s.tokens -= 1;
    s.lastInput = wall;
    const inp: Input = {
      s: seq,
      mx: clampNum(d[1], -1, 1),
      mz: clampNum(d[2], -1, 1),
      ay: clampNum(d[3], -1, 1),
      ax: clampNum(d[6], -1, 1),
      b: (+d[4] | 0) & B_ALL,
      t: Number.isFinite(+d[5]) ? +d[5] : wall,
    };
    if (inp.b & ~1 || Math.abs(inp.mx) + Math.abs(inp.mz) > 0.3) s.lastActive = wall;
    this.applyInput(s, inp, wall);
  }

  applyInput(s: Slot, inp: Input, wall: number) {
    s.lastSeq = inp.s;
    if (this.phase === PH_OVER || !s.alive) return;
    const r = stepPlayer(s.p, inp, s.frozen);
    if (r) {
      const tP = Math.max(wall - MAX_REWIND, Math.min(wall, inp.t));
      s.swing = { tP, kind: r, used: false };
      if (this.phase === PH_PLAY) this.tryRewind(s, tP, wall);
    }
  }

  // Favour the swinger: look back through the ball's recent path for a moment
  // it sat in this player's hitbox while their swing was active.
  tryRewind(s: Slot, tP: number, wall: number) {
    const b = this.ball;
    if (b.st !== BS_FLIGHT && b.st !== BS_PENDING) return;
    const c = hitCentre(s.p, { x: 0, y: 0, z: 0 });
    const reach = SWING.hitR + BALL_R;
    if (b.st === BS_PENDING && b.pend) {
      if (b.pend.victim === s.idx) {
        const ct = b.pend.ct;
        if (tP - 0.06 <= ct && ct <= tP + SWING.act1 + 0.02) {
          const dx = b.k.x - c.x, dy = b.k.y - c.y, dz = b.k.z - c.z;
          if (dx * dx + dy * dy + dz * dz <= (reach + 0.6) ** 2) this.doHit(s, b.k.x, b.k.y, b.k.z, ct);
        }
        return;
      }
    }
    const lo = tP + SWING.act0, hi = Math.min(wall, tP + SWING.act1);
    const limit = b.st === BS_PENDING && b.pend ? b.pend.ct : Infinity;
    for (const h of this.hist) {
      if (h.e !== b.epoch || h.t < lo || h.t > hi || h.t >= limit) continue;
      const dx = h.x - c.x, dy = h.y - c.y, dz = h.z - c.z;
      if (dx * dx + dy * dy + dz * dz <= reach * reach) {
        this.doHit(s, h.x, h.y, h.z, h.t);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- ball events

  serve() {
    if (this.phase !== PH_PLAY) return;
    const b = this.ball;
    b.st = BS_SERVE;
    b.k.x = BALL_SPAWN.x; b.k.y = BALL_SPAWN.y; b.k.z = BALL_SPAWN.z;
    b.k.vx = b.k.vy = b.k.vz = 0; b.k.lob = false; b.k.cv = 0; b.k.ct = 0;
    b.owner = -1; b.hitter = -1; b.speed = SPEED_NEUTRAL; b.hits = 0; b.epoch++;
    b.t1 = this.t + SERVE_HOVER; b.pend = null; b.bunt = false;
    this.hist.length = 0;
    this.event({ k: "serve" });
  }

  launchServe() {
    const b = this.ball;
    const alive = this.slots.filter((s): s is Slot => !!s && s.alive);
    if (!alive.length) { b.t1 = this.t + 0.5; return; }
    const tgt = alive[Math.floor(Math.random() * alive.length)];
    let dx = tgt.p.x - b.k.x, dy = tgt.p.y + 1.3 - b.k.y, dz = tgt.p.z - b.k.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    dx /= d; dy /= d; dz /= d;
    b.k.vx = dx * SPEED_NEUTRAL; b.k.vy = dy * SPEED_NEUTRAL; b.k.vz = dz * SPEED_NEUTRAL;
    b.st = BS_FLIGHT;
    this.event({ k: "launch", tg: tgt.idx });
  }

  /** contactT: server time the ball met the bat (earlier than now for lag-compensated hits). */
  doHit(s: Slot, x: number, y: number, z: number, contactT: number) {
    const b = this.ball;
    const bunt = s.swing?.kind === 2;
    // Perfect: the swing started just before the ball arrived (late, risky timing).
    const perfect = !bunt && !!s.swing && contactT - s.swing.tP <= PERFECT.window;
    b.k.x = x; b.k.y = y; b.k.z = z; b.k.vx = b.k.vy = b.k.vz = 0; b.k.cv = 0; b.k.ct = 0;
    if (!bunt) {
      b.speed = b.owner < 0 ? Math.max(SPEED_FIRST, b.speed) : nextSpeed(b.speed);
      if (perfect) b.speed = Math.min(SPEED_MAX, b.speed * PERFECT.speedMul);
    }
    const hs = bunt ? BUNT_HITSTOP : hitstopFor(b.speed) * (perfect ? PERFECT.freezeMul : 1);
    b.owner = s.idx; b.hitter = s.idx; b.hits++; b.epoch++;
    b.st = BS_HITSTOP; b.t1 = this.t + hs; b.bunt = bunt; b.perfect = perfect; b.pend = null;
    s.frozen = true;
    if (s.swing) s.swing.used = true;
    this.event({ k: "hit", s: s.idx, x: q3(x), y: q3(y), z: q3(z), spd: q3(b.speed), hs: q3(hs), bu: bunt ? 1 : 0, pf: perfect ? 1 : 0, n: b.hits });
  }

  release() {
    const b = this.ball;
    const s = this.slots[b.hitter];
    b.st = BS_FLIGHT;
    if (!s || s.gone) {
      // The hitter left mid-swing: drop a harmless pop-up instead of firing their shot.
      b.k.lob = true; b.k.vx = 0; b.k.vy = LOB_UP; b.k.vz = 0; b.k.cv = 0; b.k.ct = 0;
      b.owner = -1; b.bunt = true;
      this.event({ k: "rel", s: b.hitter, x: q3(b.k.x), y: q3(b.k.y), z: q3(b.k.z), vx: 0, vy: LOB_UP, vz: 0, spd: q3(b.speed), lb: "BUNT", bu: 1 });
      return;
    }
    s.frozen = false;
    s.p.cd = Math.min(s.p.cd, SWING.postHitTicks);
    let label: string;
    if (b.bunt) {
      b.k.lob = true;
      b.k.vx = Math.sin(s.p.f) * LOB_FWD; b.k.vy = LOB_UP; b.k.vz = Math.cos(s.p.f) * LOB_FWD;
      label = "BUNT";
    } else {
      const targets = this.slots.map((o) => (o && o !== s && o.alive ? o.p : null));
      const d = shotDir(s.p.f, s.p.ay, s.p.ax, !s.p.g, b.k, targets);
      b.k.lob = false;
      b.k.vx = d.x * b.speed; b.k.vy = d.y * b.speed; b.k.vz = d.z * b.speed;
      b.k.cv = d.cv; b.k.ct = d.ct;
      label = (b.perfect ? "PERFECT " : "") + d.label;
    }
    this.event({
      k: "rel", s: s.idx, x: q3(b.k.x), y: q3(b.k.y), z: q3(b.k.z),
      vx: q3(b.k.vx), vy: q3(b.k.vy), vz: q3(b.k.vz), spd: q3(b.speed), lb: label, bu: b.bunt ? 1 : 0,
      pf: b.perfect ? 1 : 0, cv: b.k.cv ? 1 : 0,
    });
  }

  startPending(v: Slot, ct: number) {
    const b = this.ball;
    const sp = Math.hypot(b.k.vx, b.k.vy, b.k.vz) || 1;
    b.pend = { victim: v.idx, ct, dx: b.k.vx / sp, dy: b.k.vy / sp, dz: b.k.vz / sp };
    b.st = BS_PENDING;
    b.k.vx = b.k.vy = b.k.vz = 0; b.k.cv = 0; b.k.ct = 0;
    // Wait long enough for any human's late swing to arrive (the victim's own, or a
    // player the ball passed on the way). Bot-only matches confirm at once.
    let grace = 0;
    for (const o of this.slots) {
      if (!o?.conn || !o.alive || o.idx === b.owner) continue;
      grace = Math.max(grace, Math.max(0.03, Math.min(MAX_KO_GRACE, o.conn.rtt * 0.6 + 0.03)));
    }
    b.t1 = this.t + grace;
    if (grace <= 0) this.confirmKO();
  }

  confirmKO() {
    const b = this.ball;
    const pend = b.pend;
    b.pend = null;
    b.st = BS_GONE;
    if (!pend) return;
    const v = this.slots[pend.victim];
    if (!v) return;
    v.alive = false;
    v.frozen = false;
    v.swing = null;
    v.stocks = Math.max(0, v.stocks - 1);
    if (v.stocks <= 0) { v.out = true; v.elim = ++this.elimCount; }
    this.event({
      k: "ko", v: v.idx, by: b.owner, x: q3(b.k.x), y: q3(b.k.y), z: q3(b.k.z),
      dx: q3(pend.dx), dy: q3(pend.dy), dz: q3(pend.dz), left: v.stocks, spd: q3(b.speed),
    });
    this.afterKO(v);
  }

  afterKO(v: Slot | null) {
    const left = this.contenders();
    if (left.length <= 1) {
      this.after(GAMEOVER_DELAY, () => this.gameOver());
      return;
    }
    if (v && v.stocks > 0 && !v.gone) this.after(RESPAWN_DELAY, () => this.respawn(v));
    this.after(SERVE_DELAY, () => this.serve());
  }

  respawn(v: Slot) {
    if (this.phase !== PH_PLAY || v.gone || v.stocks <= 0) return;
    let best = { x: 0, z: 0 }, bestD = -1;
    for (let i = 0; i < 16; i++) {
      const x = (Math.random() * 2 - 1) * (HX - 2.5), z = (Math.random() * 2 - 1) * (HZ - 2.5);
      let d = 99;
      for (const o of this.slots) if (o && o !== v && o.alive) d = Math.min(d, Math.hypot(x - o.p.x, z - o.p.z));
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
    v.p = newPState(best.x, best.z);
    v.alive = true;
    v.frozen = false;
    v.swing = null;
    v.invulnUntil = this.t + INVULN;
    this.event({ k: "spawn", s: v.idx, x: q3(best.x), z: q3(best.z) });
  }

  gameOver() {
    if (this.phase === PH_OVER) return;
    this.phase = PH_OVER;
    const ranked = this.slots
      .filter((s): s is Slot => !!s)
      .sort((a, b) => {
        const ra = a.out || a.gone ? a.elim : 1e9, rb = b.out || b.gone ? b.elim : 1e9;
        return rb - ra || b.stocks - a.stocks;
      })
      .map((s) => s.idx);
    this.event({ k: "over", w: ranked[0] ?? -1, rank: ranked });
    this.end();
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    for (const s of this.slots) {
      if (s?.conn) {
        s.conn.match = null;
        s.conn.state = "menu";
        s.conn.send('{"t":"end"}');
        s.conn = null;
      }
    }
    this.onEnd(this);
  }

  removeConn(conn: Conn) {
    let removed = false;
    for (const s of this.slots) {
      if (s && s.conn === conn) { removed = true; this.dropSlot(s); }
    }
    if (conn.match === this) conn.match = null;
    if (!removed || this.phase === PH_OVER || this.ended) return;
    if (!this.humans().length) { this.end(); return; }
    if (this.contenders().length <= 1) this.after(1.2, () => this.gameOver());
  }

  private dropSlot(s: Slot) {
    s.conn = null;
    s.gone = true;
    s.alive = false;
    s.frozen = false;
    if (!s.out) { s.out = true; s.elim = ++this.elimCount; }
    s.stocks = 0;
    this.event({ k: "leave", s: s.idx });
    if (this.phase === PH_OVER) return;
    const b = this.ball;
    if (b.st === BS_HITSTOP && b.hitter === s.idx) this.release();
    // A ball pinned on (or owned by) someone who just left becomes a harmless pop-up.
    if (b.st === BS_PENDING && (b.pend?.victim === s.idx || b.owner === s.idx)) {
      b.pend = null; b.st = BS_FLIGHT; b.owner = -1; b.k.lob = true; b.k.vy = 4;
    }
    if (b.owner === s.idx) b.owner = -1;
  }

  // ---------------------------------------------------------------- tick

  tick(t: number) {
    if (this.ended) return;
    this.t = t;
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.t <= t).sort((a, b) => a.t - b.t);
      if (due.length) {
        this.timers = this.timers.filter((x) => x.t > t);
        for (const d of due) { d.fn(); if (this.ended) return; }
      }
    }

    for (const s of this.slots) {
      if (s?.bot && s.alive && this.phase !== PH_OVER) {
        const inp = s.bot.think(this, s);
        this.applyInput(s, inp, t);
      }
    }

    const wall = now();
    for (const s of this.slots) {
      if (!s?.conn || this.phase === PH_OVER) continue;
      // Inputs stopped (hidden tab, stall): keep simulating so nobody hangs mid-air,
      // and drain the input budget so withheld inputs can't be burst later.
      if (s.alive && wall - s.lastInput > IDLE_STEP_AFTER) {
        stepPlayer(s.p, { s: s.lastSeq, mx: 0, mz: 0, ay: 0, ax: 0, b: 0, t: wall }, s.frozen);
        s.tokens = Math.max(0, Math.min(6, s.tokens + (wall - s.tokenT) * 60) - 1);
        s.tokenT = wall;
      }
      // The AFK clock only runs while you can actually play: K.O.'d, knocked out of the set
      // (spectating) or waiting for the countdown never counts as idle.
      if (!s.alive || this.phase !== PH_PLAY) s.lastActive = wall;
      else if (wall - s.lastActive > AFK_TIMEOUT) {
        const c = s.conn;
        c.send('{"t":"end","r":"afk"}');
        this.removeConn(c);
        c.state = "menu";
        if (this.ended) return;
      }
    }
    if (this.phase === PH_PLAY && t - this.cdEnd > MATCH_TIME_LIMIT) { this.gameOver(); return; }

    this.pushApart();
    this.stepBall(t);
    if (!this.ended) this.snapshot();
  }

  pushApart() {
    const r = PLAYER.pushRadius;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const a = this.slots[i];
      if (!a?.alive) continue;
      for (let j = i + 1; j < MAX_PLAYERS; j++) {
        const b = this.slots[j];
        if (!b?.alive) continue;
        const dx = a.p.x - b.p.x, dz = a.p.z - b.p.z;
        const d = Math.hypot(dx, dz);
        if (d < r && d > 1e-4 && Math.abs(a.p.y - b.p.y) < 2) {
          const k = ((r - d) * 0.25) / d;
          if (!a.frozen) { a.p.x += dx * k; a.p.z += dz * k; }
          if (!b.frozen) { b.p.x -= dx * k; b.p.z -= dz * k; }
        }
      }
    }
  }

  stepBall(t: number) {
    const b = this.ball;
    if (b.st === BS_SERVE) {
      if (t >= b.t1) this.launchServe();
      else return;
    }
    if (b.st === BS_HITSTOP) {
      if (t >= b.t1) this.release();
      else return;
    }
    if (b.st === BS_PENDING) {
      if (t >= b.t1) this.confirmKO();
      return;
    }
    if (b.st !== BS_FLIGHT) return;

    const k = b.k;
    const n = substepsFor(k, DT);
    const h = DT / n;
    const reach2 = (SWING.hitR + BALL_R) ** 2;
    const hurt2 = (PLAYER.radius + BALL_R) ** 2;
    const c = { x: 0, y: 0, z: 0 };
    const harmful = b.owner >= 0 && !k.lob;

    for (let i = 0; i < n; i++) {
      const ts = t - DT + (i + 1) * h;
      advanceBall(k, h);
      this.hist.push({ t: ts, x: k.x, y: k.y, z: k.z, e: b.epoch });

      // Active swings take priority; closest bat wins a tie.
      let hitBy: Slot | null = null, hitD = Infinity;
      for (const s of this.slots) {
        if (!s?.alive || !s.swing || s.swing.used || s.frozen) continue;
        if (ts < s.swing.tP + SWING.act0 || ts > s.swing.tP + SWING.act1) continue;
        hitCentre(s.p, c);
        const dx = k.x - c.x, dy = k.y - c.y, dz = k.z - c.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= reach2 && d2 < hitD) { hitD = d2; hitBy = s; }
      }
      if (hitBy) { this.doHit(hitBy, k.x, k.y, k.z, ts); break; }

      if (harmful) {
        let victim: Slot | null = null;
        for (const s of this.slots) {
          if (!s?.alive || s.idx === b.owner || ts < s.invulnUntil) continue;
          if (hurtDist2(s.p, k.x, k.y, k.z) <= hurt2) { victim = s; break; }
        }
        if (victim) { this.startPending(victim, ts); break; }
      }
    }
    // Keep ~0.3 s of path for lag compensation.
    const cutoff = t - MAX_REWIND - 0.1;
    let drop = 0;
    while (drop < this.hist.length && this.hist[drop].t < cutoff) drop++;
    if (drop) this.hist.splice(0, drop);
  }

  snapshot() {
    const b = this.ball;
    const p = this.slots.map((s) => {
      if (!s) return null;
      let f = 0;
      if (s.alive) f |= PF_ALIVE;
      if (s.frozen) f |= PF_FROZEN;
      if (this.t < s.invulnUntil) f |= PF_INVULN;
      if (s.out) f |= PF_OUT;
      if (s.gone) f |= PF_GONE;
      return encodeP(s.p, f, s.stocks);
    });
    const left = b.st === BS_HITSTOP || b.st === BS_SERVE || b.st === BS_PENDING ? Math.max(0, b.t1 - this.t) : 0;
    const k = b.k;
    const ba = [b.st, q3(k.x), q3(k.y), q3(k.z), q3(k.vx), q3(k.vy), q3(k.vz), b.owner, q3(b.speed), b.hits, q3(left), k.lob ? 1 : 0, b.hitter, k.cv, q3(k.ct)];
    const body = JSON.stringify({ st: q3(this.t), ph: this.phase, p, b: ba }).slice(1);
    for (const s of this.slots) if (s?.conn) s.conn.send(`{"t":"s","a":${s.lastSeq},${body}`);
  }
}

function clampNum(v: unknown, lo: number, hi: number): number {
  const n = +(v as number);
  if (!Number.isFinite(n)) return 0;
  return n < lo ? lo : n > hi ? hi : n;
}

export { KO_HOLD };
