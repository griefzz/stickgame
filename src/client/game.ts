import * as THREE from "three";
import {
  BALL_SPAWN, DT, HX, KO_HOLD, MAX_PLAYERS, PLAYER, SLOTS, SPEED_NEUTRAL, SWING, displaySpeed, speedFeel,
} from "../shared/constants";
import { advanceBall, newKin, type BallKin } from "../shared/ball";
import {
  B_BUNT, B_DASH, B_JUMP, B_JUMP_P, B_SWING, copyP, hurtDist2, newPState, q3, stepPlayer, type Input, type PState,
} from "../shared/player";
import { shotDir } from "../shared/shot";
import {
  BS_FLIGHT, BS_GONE, BS_HITSTOP, BS_NONE, BS_PENDING, BS_SERVE, B_HITS, B_HITTER, B_LEFT, B_LOB, B_OWNER,
  B_SPEED, B_STATE, B_VX, B_VY, B_VZ, B_X, B_Y, B_Z, PF_ALIVE, PF_FROZEN, PF_GONE, PF_INVULN, PF_OUT,
  B_CT, B_CV, PH_COUNTDOWN, PH_OVER, P_AIRJ, P_AX, P_DASH, P_FLAGS, P_STOCKS, P_WALLJ, decodeP, type RosterEntry,
} from "../shared/protocol";
import { sfx, stopCharge } from "./audio";
import { banner, callout, countdown, hudSetup, hudShow, hudUpdate, netInfo, type HudPlayer } from "./hud";
import { rumble, sampleInput } from "./input";
import type { Net } from "./net";
import { clearTrail, pushTrail, setTelegraph, updateBall } from "./render/ball";
import { cancelFocus, koFocus, shake, updateCamera } from "./render/camera";
import { Character, type PlayerView } from "./render/character";
import { burst, flash, killRing, ring } from "./render/fx";
import { UP, WHITE, crowd, v3 } from "./render/scene";

const INTERP = 0.06;
const MAX_TICKS_PER_FRAME = 6;

interface Snap { st: number; ph: number; p: (number[] | null)[]; b: number[] }

export const chars: Character[] = Array.from({ length: MAX_PLAYERS }, (_, i) => new Character(i));
const slotColor = (i: number) => (i >= 0 ? chars[i].color : WHITE);

type Ring = ReturnType<typeof ring>;

export class ClientMatch {
  net: Net;
  slot: number;
  roster: (RosterEntry | null)[];
  practice: boolean;
  roomCode: string | null;
  cdEnd: number;
  snaps: Snap[] = [];
  latest: Snap | null = null;
  phase = PH_COUNTDOWN;
  over = false;
  onOver: (rank: number[], winner: number) => void = () => {};

  // prediction
  pred: PState;
  prevPred: PState;
  pending: Input[] = [];
  seq = 0;
  accum = 0;
  frozenLocal = false;
  aliveLocal = true;
  err = v3();
  controls = true;

  // ball
  kin: BallKin = newKin();
  ballPos = v3(BALL_SPAWN.x, BALL_SPAWN.y, BALL_SPAWN.z);
  ballOn = false;
  lastBounceT = 0;
  lastFreeze = 0;
  hitBunt = false;
  chargeRing: Ring | null = null;
  koHold: { until: number; x: number; y: number; z: number; owner: number } | null = null;
  koPose: ({ until: number; x: number; y: number; z: number; f: number; d: THREE.Vector3 } | null)[] = [null, null, null, null];
  threat = -1;
  lastCount = "";
  goUntil = 0;
  lastAj = [0, 0, 0, 0];
  lastWj = [0, 0, 0, 0];
  lastDash = [0, 0, 0, 0];
  disposed = false;
  private timers: number[] = [];

  /** setTimeout scoped to this match: cancelled on dispose so nothing leaks into the next one. */
  later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(() => { if (!this.disposed) fn(); }, ms));
  }

  constructor(net: Net, slot: number, roster: (RosterEntry | null)[], cdEnd: number, practice: boolean, roomCode: string | null = null) {
    this.net = net;
    this.slot = slot;
    this.roster = roster;
    this.cdEnd = cdEnd;
    this.practice = practice;
    this.roomCode = roomCode;
    this.pred = newPState(0, 0);
    this.prevPred = newPState(0, 0);
    for (const c of chars) c.reset();
    clearTrail();
    setTelegraph(false);
    cancelFocus();
    hudSetup(roster, slot);
    hudShow(true);
    countdown(null);
  }

  dispose() {
    this.disposed = true;
    for (const id of this.timers) clearTimeout(id);
    this.timers.length = 0;
    for (const c of chars) c.reset();
    clearTrail();
    setTelegraph(false);
    killRing(this.chargeRing);
    stopCharge();
    countdown(null);
    hudShow(false);
  }

  // ---------------------------------------------------------------- network in

  onSnapshot(m: { a: number; st: number; ph: number; p: (number[] | null)[]; b: number[] }) {
    const s: Snap = { st: m.st, ph: m.ph, p: m.p, b: m.b };
    const first = !this.latest;
    this.snaps.push(s);
    while (this.snaps.length > 2 && this.snaps[0].st < m.st - 1.2) this.snaps.shift();
    this.latest = s;
    this.phase = m.ph;

    if (first) {
      m.p.forEach((p, i) => { if (p && p[P_FLAGS] & PF_ALIVE) chars[i].spawn(p[0], p[2], performance.now() / 1000); });
    }

    const me = m.p[this.slot];
    if (!me) return;
    const flags = me[P_FLAGS];
    const alive = !!(flags & PF_ALIVE);
    this.pending = this.pending.filter((i) => i.s > m.a);
    if (!alive) { this.aliveLocal = false; return; }
    const oldX = this.pred.x, oldY = this.pred.y, oldZ = this.pred.z;
    decodeP(me, this.pred);
    this.frozenLocal = !!(flags & PF_FROZEN);
    for (const inp of this.pending) stepPlayer(this.pred, inp, this.frozenLocal);
    if (!this.aliveLocal || first) {
      this.aliveLocal = true;
      copyP(this.prevPred, this.pred);
      this.err.set(0, 0, 0);
      return;
    }
    const dx = oldX - this.pred.x, dy = oldY - this.pred.y, dz = oldZ - this.pred.z;
    if (dx * dx + dy * dy + dz * dz < 9) this.err.x += dx, this.err.y += dy, this.err.z += dz;
    else this.err.set(0, 0, 0);
    this.prevPred.x -= dx; this.prevPred.y -= dy; this.prevPred.z -= dz;
  }

  onEvent(e: Record<string, any>) {
    const rt = performance.now() / 1000;
    switch (e.k) {
      case "fight":
        this.goUntil = rt + 0.8;
        countdown("GO");
        sfx.beep(true);
        break;
      case "serve": {
        const p = BALL_SPAWN;
        ring(p, { color: WHITE, from: 0.3, to: 3.5, life: 0.6, peak: 0.9 });
        burst(p, 40, { color: WHITE, speed: [2, 7], life: [0.3, 0.8], size: [0.06, 0.14], drag: 2.5 });
        sfx.serve();
        clearTrail();
        this.lastFreeze = 0;
        this.koHold = null;
        break;
      }
      case "hit": {
        const c = slotColor(e.s), k = speedFeel(e.spd);
        const at = { x: e.x, y: e.y, z: e.z };
        this.lastFreeze = e.hs;
        this.hitBunt = !!e.bu;
        burst(at, Math.round(6 + 24 * k), { color: c, speed: [2, 6 + 10 * k], life: [0.15, 0.4], size: [0.06, 0.14], drag: 4, white: true });
        killRing(this.chargeRing);
        this.chargeRing = null;
        if (e.hs > 0.14) {
          this.chargeRing = ring(at, { color: c, from: 2.2 + 4 * k, to: 0.45, life: e.hs, mode: "charge", peak: 0.85 });
          sfx.charge(e.hs, k);
        }
        if (e.bu) sfx.bunt(); else sfx.thump(k);
        shake(0.08 + 0.25 * k);
        if (e.pf) {
          // Perfect: a white snap ring, a sparkle and a bright ping on contact.
          ring(at, { color: WHITE, from: 0.3, to: 3.2, life: 0.3, peak: 1, boost: 3 });
          burst(at, 40, { color: WHITE, speed: [6, 16], life: [0.15, 0.35], size: [0.05, 0.12], drag: 5 });
          flash("#ffffff", 0.12);
          sfx.perfect();
          shake(0.15);
        }
        if (e.s === this.slot) {
          this.frozenLocal = true;
          rumble(e.pf ? 1 : 0.3 + 0.5 * k, e.pf ? 1 : 0.6, e.pf ? 220 : 90 + 200 * k);
        }
        break;
      }
      case "rel": {
        const c = slotColor(e.s), k = speedFeel(e.spd);
        const at = { x: e.x, y: e.y, z: e.z };
        const d = v3(e.vx, e.vy, e.vz).normalize();
        killRing(this.chargeRing);
        this.chargeRing = null;
        stopCharge();
        clearTrail();
        if (e.bu) {
          ring(at, { color: c, from: 0.3, to: 1.8, life: 0.35, peak: 0.7 });
          callout(at.x, at.y, at.z, "BUNT", `SPD ${displaySpeed(e.spd)} HELD`, SLOTS[e.s].color);
        } else {
          ring(at, { color: c, from: 0.4, to: 2.5 + 5 * k, life: 0.42, peak: 0.9 });
          burst(at, Math.round(18 + 70 * k), { color: c, dir: d, spread: 0.55, speed: [8 + 20 * k, 16 + 45 * k], life: [0.2, 0.55], size: [0.08, 0.2], drag: 3.5, white: true });
          shake(0.22 + 0.6 * k);
          crowd.excite = Math.min(1.3, crowd.excite + 0.12 + 0.45 * k);
          callout(at.x, at.y, at.z, e.lb, `SPD ${displaySpeed(e.spd)}${e.cv ? " · CURVE" : ""}`, SLOTS[e.s].color);
          sfx.hit(k);
          if (e.cv) sfx.curve();
          if (k > 0.5) flash(SLOTS[e.s].color, 0.1 + 0.22 * k);
        }
        if (e.s === this.slot) {
          this.frozenLocal = false;
          this.pred.cd = Math.min(this.pred.cd, SWING.postHitTicks);
          rumble(0.6 * k + 0.2, 0.4, 80 + 120 * k);
        }
        break;
      }
      case "ko": {
        const by = e.by as number, v = e.v as number;
        const oc = slotColor(by), at = v3(e.x, e.y, e.z);
        const d = v3(e.dx, e.dy, e.dz);
        this.koHold = { until: rt + KO_HOLD, x: e.x, y: e.y, z: e.z, owner: by };
        const vp = this.latest?.p[v];
        const vx = vp ? vp[0] : e.x, vy = vp ? vp[1] : 0, vz = vp ? vp[2] : e.z, vf = vp ? vp[6] : 0;
        this.koPose[v] = { until: rt + KO_HOLD, x: vx, y: vy, z: vz, f: vf, d };
        killRing(this.chargeRing);
        this.chargeRing = ring(at, { color: oc, from: 6, to: 0.5, life: KO_HOLD, mode: "charge", peak: 1 });
        flash("#ffffff", 0.3);
        shake(0.45);
        sfx.charge(KO_HOLD, 1);
        koFocus(v3(vx, vy + 1.1, vz), rt, KO_HOLD + 1.6);
        if (v === this.slot) rumble(1, 1, 500);
        const victim = chars[v], left = e.left as number;
        const vName = this.roster[v]?.n ?? SLOTS[v].tag, bName = by >= 0 ? this.roster[by]?.n ?? SLOTS[by].tag : "The ball";
        this.later(KO_HOLD * 1000, () => {
          this.koPose[v] = null;
          killRing(this.chargeRing);
          this.chargeRing = null;
          this.koHold = null;
          victim.knockOut(vx, vy, vz, d);
          ring(at, { color: oc, from: 0.5, to: 11, life: 0.75, peak: 1 });
          ring(at, { color: victim.color, from: 0.3, to: 6, life: 0.5, peak: 1 });
          burst(at, 150, { color: oc, speed: [6, 30], life: [0.4, 1.2], size: [0.1, 0.3], drag: 1.8, grav: 8, white: true });
          burst(at, 80, { color: victim.color, dir: d, spread: 0.7, speed: [10, 28], life: [0.4, 1], size: [0.1, 0.25], drag: 2 });
          shake(1);
          crowd.excite = 1.6;
          flash(by >= 0 ? SLOTS[by].color : "#ffffff", 0.45);
          stopCharge();
          sfx.ko();
          clearTrail();
          const who = v === this.slot ? "You lose a stock" : by === this.slot ? `You take a stock from ${vName}` : `${bName} takes a stock from ${vName}`;
          banner("K.O.", left > 0 ? `${who} · ${left} left` : v === this.slot ? "You are out of the set" : `${vName} is out of the set`, by >= 0 ? SLOTS[by].color : "#ffffff");
        });
        break;
      }
      case "spawn":
        chars[e.s].spawn(e.x, e.z, rt);
        sfx.serve();
        break;
      case "leave":
        if (e.s !== this.slot) callout(0, 6, 0, `${this.roster[e.s]?.n ?? "A player"} left`, "DISCONNECTED", SLOTS[e.s].color);
        break;
      case "over": {
        this.over = true;
        const w = e.w as number;
        const name = w >= 0 ? this.roster[w]?.n ?? SLOTS[w].tag : "Nobody";
        crowd.excite = 1.6;
        banner("GAME", w === this.slot ? "You win the set" : `${name} wins the set`, w >= 0 ? SLOTS[w].color : "#ffffff");
        if (w === this.slot) sfx.win();
        this.later(2600, () => this.onOver(e.rank as number[], w));
        break;
      }
    }
  }

  // ---------------------------------------------------------------- per frame

  frame(dt: number, rt: number) {
    const now = this.net.serverNow();
    const L = this.latest;

    // Fixed-rate input ticks with client-side prediction.
    this.accum = Math.min(this.accum + dt, DT * MAX_TICKS_PER_FRAME);
    while (this.accum >= DT) { this.accum -= DT; this.tick(now); }
    const alpha = this.accum / DT;
    const ek = Math.exp(-dt * 12);
    this.err.multiplyScalar(ek);

    // Countdown
    if (this.phase === PH_COUNTDOWN && !this.over) {
      const left = this.cdEnd - now;
      const txt = left > 0 && left <= 3.05 ? String(Math.ceil(left - 0.05)) : left > 3.05 ? "READY" : "";
      if (txt && txt !== this.lastCount) { this.lastCount = txt; if (txt !== "READY") sfx.beep(false); }
      countdown(txt || null);
    } else if (rt > this.goUntil) countdown(null);

    // ---------------- players
    const renderT = now - INTERP;
    let s0: Snap | null = null, s1: Snap | null = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].st <= renderT) { s0 = this.snaps[i]; s1 = this.snaps[i + 1] ?? null; break; }
    }
    if (!s0 && this.snaps.length) s0 = this.snaps[0];
    const frac = s0 && s1 ? Math.min(1, Math.max(0, (renderT - s0.st) / (s1.st - s0.st || 1))) : 0;

    const views: (PlayerView | null)[] = [];
    const hudP: HudPlayer[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const pa = s0?.p[i];
      if (!L || !pa || !this.roster[i]) { views.push(null); hudP.push({ present: false, alive: false, out: true, gone: true, stocks: 0, ko: false, airborne: false, invuln: false, x: 0, y: 0, z: 0, tagVisible: false }); continue; }
      const pl = L.p[i]!;
      const flags = pl[P_FLAGS];
      let v: PlayerView;
      if (i === this.slot && this.aliveLocal && flags & PF_ALIVE) {
        const a = this.prevPred, b = this.pred;
        const sa = b.sa >= 0 ? (b.sa + alpha) * DT : -1;
        v = {
          x: a.x + (b.x - a.x) * alpha + this.err.x, y: Math.max(0, a.y + (b.y - a.y) * alpha + this.err.y), z: a.z + (b.z - a.z) * alpha + this.err.z,
          vx: b.vx, vz: b.vz, f: b.f, alive: true, frozen: this.frozenLocal, swingAge: sa, swingKind: b.sk,
          invuln: !!(flags & PF_INVULN), threat: null, ready: false, local: true, dash: b.ds > 0,
        };
      } else {
        const pb = s1?.p[i] ?? pa;
        const lerpA = (k: number) => pa[k] + (pb[k] - pa[k]) * frac;
        let df = pb[6] - pa[6];
        df = ((((df + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
        const fl = (s1 ? pb : pa)[P_FLAGS];
        const sa = pb[10];
        v = {
          x: lerpA(0), y: lerpA(1), z: lerpA(2), vx: pb[3], vz: pb[5], f: pa[6] + df * frac,
          alive: !!(fl & PF_ALIVE), frozen: !!(fl & PF_FROZEN), swingAge: sa >= 0 ? sa * DT : -1, swingKind: pb[11],
          invuln: !!(fl & PF_INVULN), threat: null, ready: false, local: false, dash: (pb[P_DASH] ?? 0) > 0,
        };
        if (!s1 && L.st < renderT) {
          const ex = Math.min(0.1, renderT - L.st);
          v.x += pa[3] * ex; v.z += pa[5] * ex;
        }
      }
      // Hold the victim in place while the ball hangs on them before the K.O. burst.
      const kp = this.koPose[i];
      if (kp && rt < kp.until) {
        v.alive = true; v.x = kp.x; v.y = kp.y; v.z = kp.z; v.f = kp.f; v.vx = v.vz = 0; v.frozen = true; v.swingAge = -1;
      }
      views.push(v);
      hudP.push({
        present: true, alive: !!(flags & PF_ALIVE), out: !!(flags & PF_OUT), gone: !!(flags & PF_GONE), stocks: pl[P_STOCKS],
        ko: !!chars[i].ko, airborne: v.y > 0.3, invuln: !!(flags & PF_INVULN), x: v.x, y: v.y, z: v.z,
        tagVisible: v.alive && !chars[i].ko,
      });
    }

    // ---------------- ball
    let state = BS_NONE, owner = -1, speed = SPEED_NEUTRAL, hits = 0, left = 0, hitter = -1;
    if (L) {
      const b = L.b;
      state = b[B_STATE]; owner = b[B_OWNER]; speed = b[B_SPEED]; hits = b[B_HITS]; hitter = b[B_HITTER];
      left = Math.max(0, b[B_LEFT] - (now - L.st));
      if (state === BS_FLIGHT) {
        const k = this.kin;
        k.x = b[B_X]; k.y = b[B_Y]; k.z = b[B_Z]; k.vx = b[B_VX]; k.vy = b[B_VY]; k.vz = b[B_VZ]; k.lob = !!b[B_LOB];
        k.cv = b[B_CV] ?? 0; k.ct = b[B_CT] ?? 0;
        const span = Math.min(0.3, Math.max(0, now - L.st));
        const n = Math.max(1, Math.min(240, Math.ceil((Math.hypot(k.vx, k.vy, k.vz) * span) / 0.3)));
        const h = span / n;
        let tc = L.st;
        const sf = speedFeel(speed), col = slotColor(owner);
        for (let i = 0; i < n; i++) {
          tc += h;
          advanceBall(k, h, (axis, side, x, y, z, imp) => {
            if (tc <= this.lastBounceT + 1e-4) return;
            this.lastBounceT = tc;
            this.bounceFx(axis, side, x, y, z, k.lob ? Math.min(1, imp / 20) * 0.4 : sf, col, k.lob);
            pushTrail(x, y, z, rt);
          });
        }
        this.ballPos.set(k.x, k.y, k.z);
        this.ballOn = true;
      } else if (state === BS_HITSTOP || state === BS_PENDING) {
        this.ballPos.set(b[B_X], b[B_Y], b[B_Z]);
        this.ballOn = true;
      } else if (state === BS_SERVE) {
        this.ballPos.set(b[B_X], b[B_Y] + Math.sin(rt * 5) * 0.12, b[B_Z]);
        this.ballOn = true;
      } else this.ballOn = false;
    }
    if (this.koHold && rt < this.koHold.until) {
      this.ballPos.set(this.koHold.x, this.koHold.y, this.koHold.z);
      this.ballOn = true;
      owner = this.koHold.owner;
    }
    const frozen = state === BS_HITSTOP || state === BS_PENDING || (!!this.koHold && rt < this.koHold.until);
    if (this.ballOn && state === BS_FLIGHT) pushTrail(this.ballPos.x, this.ballPos.y, this.ballPos.z, rt);

    // Threat: who is the ball heading for?
    this.threat = -1;
    if (L && state === BS_FLIGHT && !this.kin.lob) this.threat = this.findThreat(views, owner);
    const threatColor = slotColor(owner);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const v = views[i];
      if (v && i === this.threat) { v.threat = threatColor; v.ready = true; }
    }

    // Aim telegraph during hitstop.
    if (state === BS_HITSTOP && !this.hitBunt && hitter >= 0 && views[hitter]) {
      const hv = views[hitter]!;
      const isMe = hitter === this.slot;
      const f = isMe ? this.pred.f : hv.f;
      const ay = isMe ? this.pred.ay : (L!.p[hitter]![7] ?? 0);
      const ax = isMe ? this.pred.ax : (L!.p[hitter]![P_AX] ?? 0);
      const air = isMe ? !this.pred.g : hv.y > 0.05;
      const targets = views.map((o, i) => (o && i !== hitter && o.alive ? o : null));
      const d = shotDir(f, ay, ax, air, this.ballPos, targets);
      const total = Math.max(0.05, this.lastFreeze);
      const strength = 0.35 + 0.65 * Math.min(1, 1 - left / total);
      setTelegraph(true, this.ballPos, d, slotColor(hitter), strength, rt);
    } else setTelegraph(false);

    // Double-jump puffs: a ring under the feet whenever someone spends their air jump.
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const v = views[i];
      const aj = i === this.slot && this.aliveLocal ? this.pred.aj : (L?.p[i]?.[P_AIRJ] ?? 0);
      if (v && v.alive && aj > this.lastAj[i]) {
        const at = { x: v.x, y: v.y + 0.15, z: v.z };
        ring(at, { color: chars[i].color, normal: UP, from: 0.3, to: 1.9, life: 0.35, peak: 0.85 });
        burst(at, 14, { color: chars[i].color, speed: [2, 5], life: [0.15, 0.35], size: [0.05, 0.11], drag: 4, hemi: v3(0, -1, 0), white: true });
        if (i === this.slot) sfx.airJump();
      }
      this.lastAj[i] = aj;

      // Wall jumps: a ring flat against the wall that was kicked off.
      const local = i === this.slot && this.aliveLocal;
      const wj = local ? this.pred.wj : (L?.p[i]?.[P_WALLJ] ?? 0);
      if (v && v.alive && wj > this.lastWj[i]) {
        const nx = Math.abs(v.x) > HX - 1.5 ? -Math.sign(v.x) : 0;
        const nz = nx ? 0 : -Math.sign(v.z);
        const at = { x: v.x - nx * 0.6, y: v.y + 1, z: v.z - nz * 0.6 };
        ring(at, { color: chars[i].color, normal: v3(nx, 0, nz), from: 0.3, to: 2.2, life: 0.4, peak: 0.9 });
        burst(at, 18, { color: chars[i].color, hemi: v3(nx, 0, nz), speed: [3, 8], life: [0.15, 0.4], size: [0.05, 0.12], drag: 4, white: true });
        if (local) sfx.wallJump();
      }
      this.lastWj[i] = wj;

      // Air dash: a burst at the start, then a streak of sparks for as long as it lasts.
      const ds = local ? this.pred.ds : (L?.p[i]?.[P_DASH] ?? 0);
      if (v && v.alive && ds > 0) {
        const at = { x: v.x, y: v.y + 1.1, z: v.z };
        if (!this.lastDash[i]) {
          ring(at, { color: chars[i].color, from: 0.4, to: 2, life: 0.25, peak: 0.8 });
          if (local) sfx.dash();
        }
        burst(at, 4, { color: chars[i].color, speed: [0.5, 2], life: [0.15, 0.3], size: [0.08, 0.16], drag: 6, jitter: 0.35, white: true });
      }
      this.lastDash[i] = ds > 0 ? 1 : 0;
    }

    for (let i = 0; i < MAX_PLAYERS; i++) chars[i].update(dt, rt, views[i]);
    updateBall(dt, rt, rt, {
      visible: this.ballOn, x: this.ballPos.x, y: this.ballPos.y, z: this.ballPos.z,
      color: slotColor(owner), speedFrac: speedFeel(speed), frozen, bigFreeze: frozen && this.lastFreeze > 0.1,
    });
    const meV = views[this.slot];
    updateCamera(dt, rt, { x: this.ballPos.x, y: this.ballPos.y, z: this.ballPos.z, on: this.ballOn }, meV && meV.alive ? meV : null);
    hudUpdate(dt, { on: this.ballOn, speed, owner, frozen, hitstop: state === BS_HITSTOP, freezeLeft: left, lastFreeze: this.lastFreeze, hits, hitter, threat: this.threat }, hudP);
    netInfo(Math.round(this.net.rtt * 1000), this.practice ? "PRACTICE" : this.roomCode ? `ROOM ${this.roomCode}` : "");
  }

  tick(now: number) {
    const gi = sampleInput();
    const on = this.controls && !this.over;
    let b = 0;
    if (on) {
      if (gi.jumpHeld) b |= B_JUMP;
      if (gi.jumpPressed) b |= B_JUMP_P;
      if (gi.swingPressed) b |= B_SWING;
      if (gi.buntPressed) b |= B_BUNT;
      if (gi.dashPressed) b |= B_DASH;
    }
    const inp: Input = {
      s: ++this.seq,
      mx: on ? q3(gi.mx) : 0,
      mz: on ? q3(gi.mz) : 0,
      ay: on ? q3(gi.ay) : 0,
      ax: on ? q3(gi.ax) : 0,
      b,
      t: q3(now),
    };
    if (this.aliveLocal && this.phase !== PH_OVER) {
      copyP(this.prevPred, this.pred);
      const r = stepPlayer(this.pred, inp, this.frozenLocal);
      if (r === 1) sfx.whoosh();
      this.pending.push(inp);
      if (this.pending.length > 120) this.pending.shift();
    }
    if (!this.over) this.net.sendRaw(`{"t":"i","d":[${inp.s},${inp.mx},${inp.mz},${inp.ay},${inp.b},${inp.t},${inp.ax}]}`);
  }

  bounceFx(axis: number, side: number, x: number, y: number, z: number, k: number, col: THREE.Color, lob: boolean) {
    const n = axis === 0 ? v3(-side, 0, 0) : axis === 1 ? v3(0, -side, 0) : v3(0, 0, -side);
    const at = { x: x - n.x * 0.3, y: y - n.y * 0.3, z: z - n.z * 0.3 };
    ring(at, { color: col, normal: n, from: 0.3, to: 1.4 + 2.8 * k, life: 0.55, peak: lob ? 0.5 : 0.95 });
    burst(at, Math.round(8 + 26 * k), { color: col, hemi: n, speed: [3, 8 + 18 * k], life: [0.15, 0.45], size: [0.06, 0.14], drag: 3, white: true });
    if (!lob) shake(0.05 + 0.2 * k);
    sfx.bounce(k);
  }

  findThreat(views: (PlayerView | null)[], owner: number): number {
    const k: BallKin = { ...this.kin };
    const r2 = (PLAYER.radius + 0.9) ** 2;
    const step = 1 / 120;
    for (let i = 0; i < 150; i++) {
      const sub = Math.max(1, Math.ceil((Math.hypot(k.vx, k.vy, k.vz) * step) / 0.4));
      for (let j = 0; j < sub; j++) {
        advanceBall(k, step / sub);
        for (let s = 0; s < MAX_PLAYERS; s++) {
          const v = views[s];
          if (!v || !v.alive || s === owner) continue;
          if (hurtDist2(v, k.x, k.y, k.z) <= r2) return s;
        }
      }
      // Fast balls cover a lot of ground; cap the look-ahead by distance too.
      if (i * step * Math.hypot(k.vx, k.vy, k.vz) > 60) break;
    }
    return -1;
  }
}
