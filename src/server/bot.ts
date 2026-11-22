// Server-side bots for practice (and optional queue filling). They read the
// same state a player sees, predict the ball's path, and press the same inputs.
import { BALL_R, DT, HX, HZ, PLAYER, SWING, speedFeel, weaponOf } from "../shared/constants";
import { advanceBall, substepsFor, type BallKin } from "../shared/ball";
import { B_BUNT, B_DASH, B_JUMP, B_JUMP_P, B_SWING, B_SWING_HELD, hitCentre, type Input } from "../shared/player";
import { shotDir } from "../shared/shot";
import { BS_FLIGHT, BS_HITSTOP } from "../shared/protocol";
import type { Match, Slot } from "./match";
import { arenaOf, randomPoint, wallContact } from "../shared/arena";

const HORIZON = 78; // ticks of ball prediction (1.3 s)

interface Pred { tick: number; epoch: number; pts: Float32Array; n: number }
const cache = new WeakMap<Match, Pred>();

function predict(m: Match): Pred {
  let c = cache.get(m);
  const tick = Math.round(m.t * 60);
  if (c && c.tick === tick) return c;
  if (!c) { c = { tick, epoch: -1, pts: new Float32Array(HORIZON * 3), n: 0 }; cache.set(m, c); }
  c.tick = tick;
  c.epoch = m.ball.epoch;
  const k: BallKin = { ...m.ball.k };
  const n = substepsFor(k, DT);
  for (let i = 0; i < HORIZON; i++) {
    for (let j = 0; j < n; j++) advanceBall(k, DT / n);
    c.pts[i * 3] = k.x; c.pts[i * 3 + 1] = k.y; c.pts[i * 3 + 2] = k.z;
  }
  c.n = HORIZON;
  return c;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Bot {
  idx: number;
  seq = 0;
  skill = rnd(0.55, 0.9);
  epochSeen = -1;
  miss = false;
  lead = 0.05;
  bunt = false;
  aimAt = -1;
  aimY = 0;
  aimX = 0;
  chargeFor = 0;
  nextDash = 0;
  wander: { x: number; z: number } | null = null;
  wanderUntil = 0;
  hesitateUntil = 0;

  constructor(idx: number) { this.idx = idx; }

  think(m: Match, s: Slot): Input {
    const p = s.p, b = m.ball, t = m.t;
    let mx = 0, mz = 0, btn = 0, ay = 0, ax = 0;
    const out = (): Input => ({ s: ++this.seq, mx, mz, ay, ax, b: btn, t });

    if (b.epoch !== this.epochSeen) {
      this.epochSeen = b.epoch;
      const sp = speedFeel(b.speed);
      this.miss = Math.random() < 0.05 + (1 - this.skill) * 1.1 * Math.pow(sp, 1.2);
      this.lead = rnd(0.035, 0.16); // swinging within ~0.05 s of contact lands a perfect hit (~1 in 5)
      this.bunt = b.speed > 80 && Math.random() < 0.12;
      this.aimAt = -1;
      this.hesitateUntil = t + rnd(0.05, 0.25) * (1.2 - this.skill);
    }

    // Our own hitstop: pick an opponent and aim.
    if (s.frozen && b.st === BS_HITSTOP && b.hitter === s.idx) {
      if (this.aimAt < 0 || !m.slots[this.aimAt]?.alive) {
        const opps = m.slots.filter((o) => o && o !== s && o.alive) as Slot[];
        this.aimAt = opps.length ? opps[Math.floor(Math.random() * opps.length)].idx : -1;
        const r = Math.random();
        this.aimY = r < 0.62 ? 0 : r < 0.82 ? rnd(0.5, 1) : rnd(-1, -0.5);
        this.aimX = Math.random() < 0.22 ? (Math.random() < 0.5 ? -1 : 1) * rnd(0.6, 1) : 0;
        this.chargeFor = Math.random() < 0.25 ? rnd(0.15, 0.9) : 0;
      }
      const o = this.aimAt >= 0 ? m.slots[this.aimAt] : null;
      if (o) {
        const dx = o.p.x - b.k.x + rnd(-1.5, 1.5), dz = o.p.z - b.k.z + rnd(-1.5, 1.5);
        const d = Math.hypot(dx, dz) || 1;
        mx = dx / d; mz = dz / d;
      }
      ay = this.aimY;
      ax = this.aimX;
      if (t < b.chargeBase + this.chargeFor) btn |= B_SWING_HELD;
      return out();
    }

    if (b.st === BS_FLIGHT && t >= this.hesitateUntil) {
      const harmful = b.owner >= 0 && !b.k.lob;
      const mine = b.owner === s.idx && harmful;
      const pr = predict(m);
      const c = { x: 0, y: 0, z: 0 };
      hitCentre(p, c);
      const reach = SWING.hitR * weaponOf(s.weapon).reach + BALL_R - 0.15;
      let tHit = -1, close = false;
      for (let i = 0; i < pr.n; i++) {
        const x = pr.pts[i * 3], y = pr.pts[i * 3 + 1], z = pr.pts[i * 3 + 2];
        if (tHit < 0 && Math.hypot(x - c.x, y - c.y, z - c.z) <= reach) tHit = (i + 1) * DT;
        if (!close && Math.hypot(x - p.x, z - p.z) < 3.2 && y < 4.5) close = true;
      }
      // Who should chase a harmless ball? The nearest alive player.
      let interested = !mine && (close || !harmful);
      if (!harmful && interested) {
        let myD = Math.hypot(b.k.x - p.x, b.k.z - p.z), nearer = 0;
        for (const o of m.slots) if (o && o !== s && o.alive && Math.hypot(b.k.x - o.p.x, b.k.z - o.p.z) < myD - 1) nearer++;
        interested = nearer === 0 || close;
      }
      if (interested) {
        // Intercept: earliest predicted point we can reach in time.
        let sx = NaN, sz = NaN, sy = 0, tau = 0;
        for (let i = 0; i < pr.n; i++) {
          const x = pr.pts[i * 3], y = pr.pts[i * 3 + 1], z = pr.pts[i * 3 + 2];
          if (y > 5.0) continue;
          const tt = (i + 1) * DT;
          const need = Math.hypot(x - p.x, z - p.z) - 1.3;
          if (need <= this.moveSpeed() * tt * 0.85) { sx = x; sz = z; sy = y; tau = tt; break; }
        }
        if (sx === sx) {
          const dx = sx - p.x, dz = sz - p.z, d = Math.hypot(dx, dz);
          if (d > 0.9) {
            mx = dx / d; mz = dz / d;
            // Far from the ball with time to spare: wavedash there.
            if (d > 3.5 && tau > 0.22) btn |= this.wavedash(p, t);
          }
          else {
            // In position: turn toward an opponent so the shot goes somewhere useful.
            const o = this.pickTarget(m, s);
            if (o) {
              const ox = o.p.x - p.x, oz = o.p.z - p.z, od = Math.hypot(ox, oz) || 1;
              mx = (ox / od) * 0.21; mz = (oz / od) * 0.21;
            }
          }
          const h = sy - SWING.hitUp;
          if (h > 1.0 && p.g) {
            const v0 = PLAYER.jumpV, g = PLAYER.gravity;
            const disc = v0 * v0 - 2 * g * Math.min(h, 2.7);
            const tr = (v0 - Math.sqrt(Math.max(0, disc))) / g;
            if (tau <= tr + DT * 2) btn |= B_JUMP_P | B_JUMP;
          }
          if (!p.g && p.vy > 0) btn |= B_JUMP;
          // Ball still above us near the top of the first jump: spend the air jump.
          if (!p.g && p.aj < PLAYER.airJumps && p.vy < 1.5 && sy - SWING.hitUp - p.y > 1.2 && tau < 0.6) btn |= B_JUMP_P | B_JUMP;
          // Ball above us and a wall at our back: kick off it for more height.
          if (!p.g && p.wj < PLAYER.wallJumps && p.vy < 4 && sy - SWING.hitUp - p.y > 0.8 &&
              wallContact(arenaOf(m.arena), p.x, p.z, PLAYER.wallMargin, PLAYER.wallReach)) btn |= B_JUMP_P | B_JUMP;
          // Airborne and still well short of the ball: air dash toward it.
          if (!p.g && !p.dc && d > 3 && tau < 0.6) btn |= B_DASH;
        }
        if (tHit >= 0 && p.cd <= 0) {
          const fire = this.miss ? tHit <= 0.34 && tHit > 0.24 : tHit <= this.lead;
          // Knows it mistimed the swing: try to dash out of the ball's path instead.
          if (this.miss && harmful && tHit < 0.3 && tHit > 0.04 && Math.random() < this.skill * 0.5) {
            const vh = Math.hypot(b.k.vx, b.k.vz) || 1, side = this.idx % 2 ? 1 : -1;
            mx = (-b.k.vz / vh) * side; mz = (b.k.vx / vh) * side;
            btn |= this.wavedash(p, t, true);
          }
          if (fire) btn |= this.bunt ? B_BUNT : B_SWING;
        }
        return out();
      }
    }

    // Someone else is winding up: step off the telegraphed line.
    if (b.st === BS_HITSTOP && b.hitter !== s.idx) {
      const h = m.slots[b.hitter];
      if (h && !b.bunt) {
        const targets = m.slots.map((o) => (o && o !== h && o.alive ? o.p : null));
        const d = shotDir(h.p.f, h.p.ay, h.p.ax, !h.p.g, b.k, targets);
        const rx = p.x - b.k.x, rz = p.z - b.k.z;
        const hl = Math.hypot(d.x, d.z) || 1;
        const ux = d.x / hl, uz = d.z / hl;
        const along = rx * ux + rz * uz;
        const perpX = rx - ux * along, perpZ = rz - uz * along;
        const perp = Math.hypot(perpX, perpZ);
        if (along > 0 && perp < 2.6 && Math.random() < 0.4 + 0.6 * this.skill) {
          const sx = perp > 0.01 ? perpX / perp : -uz, sz = perp > 0.01 ? perpZ / perp : ux;
          mx = sx; mz = sz;
          btn |= this.wavedash(p, t, true);
          return out();
        }
      }
    }

    this.doWander(m, s, t);
    if (this.wander) {
      const dx = this.wander.x - p.x, dz = this.wander.z - p.z, d = Math.hypot(dx, dz);
      if (d > 0.4) {
        const k = Math.min(0.75, d * 0.3);
        mx = (dx / d) * k; mz = (dz / d) * k;
        // Long repositioning moves: wavedash (full stick so the dash goes where we want).
        if (d > 5 && Math.random() < 0.06 * this.skill) { mx = dx / d; mz = dz / d; btn |= this.wavedash(p, t); }
      }
    }
    return out();
  }

  pickTarget(m: Match, s: Slot): Slot | null {
    if (this.aimAt >= 0 && m.slots[this.aimAt]?.alive) return m.slots[this.aimAt];
    const opps = m.slots.filter((o) => o && o !== s && o.alive) as Slot[];
    if (!opps.length) return null;
    const o = opps[Math.floor(Math.random() * opps.length)];
    this.aimAt = o.idx;
    return o;
  }

  doWander(m: Match, s: Slot, t: number) {
    if (this.wander && t < this.wanderUntil) return;
    let best: { x: number; z: number } | null = null, bestScore = -1;
    for (let i = 0; i < 8; i++) {
      const { x, z } = randomPoint(arenaOf(m.arena), 2);
      if (Math.hypot(x - s.p.x, z - s.p.z) > 9) continue;
      let r = 99;
      for (const o of m.slots) if (o && o !== s && o.alive) r = Math.min(r, Math.hypot(x - o.p.x, z - o.p.z));
      const bd = Math.hypot(x - m.ball.k.x, z - m.ball.k.z);
      const score = Math.min(r, 7) + Math.min(bd, 6) * 0.4 + Math.random();
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    this.wander = best ?? { x: s.p.x, z: s.p.z };
    this.wanderUntil = t + rnd(1.2, 2.8);
  }

  /** Effective chase speed: good bots plan around wavedashing. */
  moveSpeed(): number {
    return PLAYER.speed * (1.2 + 0.8 * this.skill);
  }

  /**
   * Jump + dash on the same tick: the dash flattens the jump into a fast skid along the
   * floor, and touching down refunds the dash, so it chains. Returns the buttons to press.
   */
  wavedash(p: { g: number; dc: number; ds: number }, t: number, urgent = false): number {
    if (p.ds > 0 || t < this.nextDash) return 0;
    if (!urgent && Math.random() > 0.35 + 0.65 * this.skill) return 0;
    this.nextDash = t + (urgent ? 0.05 : 0.18 + 0.15 * (1 - this.skill));
    if (p.g) return B_JUMP_P | B_DASH;
    return p.dc ? 0 : B_DASH;
  }
}
