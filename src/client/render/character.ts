import * as THREE from "three";
import { HX, HY, HZ, PLAYER, SLOTS, SWING } from "../../shared/constants";
import { burst, ring } from "./fx";
import { TAU, UP, clamp, glowTexture, lerp, rand, scene, smooth, v3 } from "./scene";

const FS = SWING.animDur;   // swing animation length
const CONTACT = 0.55;       // fraction of the swing at contact
const POSE_WIND = 1.35, POSE_HIT = -0.7, POSE_FOLLOW = -2.5, POSE_IDLE = 0.35, RZ_IDLE = -0.6, RECOVER = 0.35;
const BAT_H = 1.55;

const softTex = glowTexture("rgba(255,255,255,1)", "rgba(255,255,255,.55)");

function rod(r: number, len: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.rotation.z = Math.PI / 2;
  return m;
}

function weapon(kind: string, dark: THREE.Material, body: THREE.Material, glow: THREE.Material, color: THREE.Color) {
  const g = new THREE.Group();
  if (kind === "hammer") {
    const h = rod(0.045, 1, dark); h.position.x = 0.5; g.add(h);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.56), body); head.position.x = 1.08; g.add(head);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.58), glow); band.position.x = 1.08; g.add(band);
  } else if (kind === "racket") {
    const h = rod(0.04, 0.6, dark); h.position.x = 0.3; g.add(h);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.045, 8, 32), glow); rim.position.x = 0.98; rim.scale.set(1.15, 0.9, 1); g.add(rim);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(0.6), transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    face.position.x = 0.98; face.scale.set(1.15, 0.9, 1); g.add(face);
  } else if (kind === "blade") {
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), dark); s.position.x = 0.7; g.add(s);
    const e = new THREE.Mesh(new THREE.BoxGeometry(1, 0.035, 0.15), glow); e.position.x = 0.85; g.add(e);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 6), body); tip.rotation.z = -Math.PI / 2; tip.position.x = 1.55; g.add(tip);
  } else {
    const h = rod(0.045, 0.45, dark); h.position.x = 0.22; g.add(h);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1, 0.36, 0.11), body); slab.position.x = 0.95; g.add(slab);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.05, 0.13), glow); edge.position.set(0.95, 0.17, 0); g.add(edge);
  }
  return g;
}

function crest(kind: string, head: THREE.Group, glow: THREE.Material, body: THREE.Material) {
  if (kind === "horns") {
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 6), glow);
      m.position.set(0.15 * s, 0.22, 0); m.rotation.z = -0.5 * s; head.add(m);
    }
  } else if (kind === "fin") {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.46), body); a.position.set(0, 0.25, -0.06); head.add(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.46), glow); b.position.set(0, 0.35, -0.06); head.add(b);
  } else if (kind === "halo") {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.024, 6, 28), glow); h.rotation.x = Math.PI / 2; h.position.y = 0.42; head.add(h);
  } else {
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), body); s.position.set(0, 0.25, 0.14 - i * 0.1); head.add(s);
    }
  }
}

const G = {
  leg: new THREE.CapsuleGeometry(0.12, 0.55, 3, 8),
  foot: new THREE.BoxGeometry(0.22, 0.13, 0.36),
  chest: new THREE.CapsuleGeometry(0.3, 0.4, 4, 12),
  belt: new THREE.TorusGeometry(0.305, 0.028, 6, 28),
  head: new THREE.SphereGeometry(0.25, 20, 14),
  visor: new THREE.CapsuleGeometry(0.055, 0.24, 2, 8),
  arm: new THREE.CapsuleGeometry(0.085, 0.42, 3, 8),
  uarm: new THREE.CapsuleGeometry(0.085, 0.5, 3, 8),
  hand: new THREE.SphereGeometry(0.1, 10, 8),
  baseRing: new THREE.RingGeometry(0.72, 0.86, 40),
  threat: new THREE.RingGeometry(1, 1.2, 48),
  shadow: new THREE.PlaneGeometry(1.8, 1.8),
  beam: new THREE.CylinderGeometry(0.8, 0.8, HY, 24, 1, true),
};

// Swoosh arc with a baked fade, as in the concept reel.
const swooshGeo = (() => {
  const g = new THREE.RingGeometry(1.05, 2.3, 24, 1, 0, 1.7);
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const a = Math.atan2(y, x), r = Math.hypot(x, y);
    const v = Math.pow(1 - clamp(a / 1.7, 0, 1), 1.6) * clamp((r - 1.05) / 1.25, 0, 1);
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
})();

const aimGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0.42); s.lineTo(0.3, 0); s.lineTo(0.14, 0); s.lineTo(0, 0.2); s.lineTo(-0.14, 0); s.lineTo(-0.3, 0); s.closePath();
  return new THREE.ShapeGeometry(s);
})();

export interface PlayerView {
  x: number; y: number; z: number;
  vx: number; vz: number;
  f: number;
  alive: boolean;
  frozen: boolean;
  swingAge: number;    // seconds since swing started, -1 when none
  swingKind: number;
  invuln: boolean;
  threat: THREE.Color | null;
  ready: boolean;      // ball incoming: hold a wind-up stance
  local: boolean;
  dash: boolean;       // mid air dash: lean into it
}

export class Character {
  idx: number;
  color: THREE.Color;
  css: string;
  g = new THREE.Group();
  inner = new THREE.Group();
  body = new THREE.Group();
  torso = new THREE.Group();
  armL = new THREE.Group();
  swing = new THREE.Group();
  legs: THREE.Group[] = [];
  swoosh: THREE.Mesh;
  baseRing: THREE.Mesh;
  threat: THREE.Mesh;
  shadow: THREE.Mesh;
  beam: THREE.Mesh;
  aim: THREE.Mesh;
  runPhase = rand(0, TAU);
  runAmt = 0;
  poseTh = POSE_IDLE;
  poseRz = RZ_IDLE;
  spawnT = -10;
  beamT = -10;
  ko: { vel: THREE.Vector3; spin: THREE.Vector3; rx: number; rz: number; t: number; x: number; y: number; z: number } | null = null;
  shown = false;
  weaponKey: string;
  weaponGroup: THREE.Group;
  mats: { dark: THREE.Material; body: THREE.Material; glow: THREE.Material };
  facing = 0;
  pos = v3();

  constructor(idx: number) {
    const def = SLOTS[idx];
    this.idx = idx;
    this.css = def.color;
    const e = (this.color = new THREE.Color(def.color));
    this.g.rotation.order = "YXZ";
    scene.add(this.g);
    this.inner.position.y = -1;
    this.g.add(this.inner);
    this.inner.add(this.body);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f1c2b, roughness: 0.5, metalness: 0.35 });
    const bodyM = new THREE.MeshStandardMaterial({ color: e, roughness: 0.45, metalness: 0.05, emissive: e, emissiveIntensity: 0.2 });
    const glow = new THREE.MeshBasicMaterial({ color: e.clone().multiplyScalar(2.4) });
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0.16 * s, 0.95, 0);
      this.body.add(hip);
      const leg = new THREE.Mesh(G.leg, dark); leg.position.y = -0.42; hip.add(leg);
      const foot = new THREE.Mesh(G.foot, bodyM); foot.position.set(0, -0.83, 0.06); hip.add(foot);
      this.legs.push(hip);
    }
    this.torso.position.y = 1;
    this.body.add(this.torso);
    const chest = new THREE.Mesh(G.chest, bodyM); chest.position.y = 0.42; this.torso.add(chest);
    const belt = new THREE.Mesh(G.belt, glow); belt.rotation.x = Math.PI / 2; belt.position.y = 0.34; this.torso.add(belt);
    const head = new THREE.Group(); head.position.y = 0.98; this.torso.add(head);
    head.add(new THREE.Mesh(G.head, dark));
    const visor = new THREE.Mesh(G.visor, glow); visor.rotation.z = Math.PI / 2; visor.position.set(0, 0.03, 0.215); head.add(visor);
    crest(def.crest, head, glow, bodyM);
    this.armL.position.set(-0.38, 0.62, 0);
    this.torso.add(this.armL);
    const arm = new THREE.Mesh(G.arm, dark); arm.position.y = -0.28; this.armL.add(arm);
    this.swing.rotation.order = "YZX";
    this.swing.position.y = BAT_H;
    this.inner.add(this.swing);
    const ua = new THREE.Mesh(G.uarm, dark); ua.rotation.z = Math.PI / 2; ua.position.x = 0.6; this.swing.add(ua);
    const hand = new THREE.Mesh(G.hand, bodyM); hand.position.x = 0.9; this.swing.add(hand);
    this.mats = { dark, body: bodyM, glow };
    this.weaponKey = def.weapon;
    this.weaponGroup = weapon(def.weapon, dark, bodyM, glow, e);
    this.weaponGroup.position.x = 0.9;
    this.swing.add(this.weaponGroup);

    this.swoosh = new THREE.Mesh(swooshGeo, new THREE.MeshBasicMaterial({
      color: e.clone().multiplyScalar(1.8), vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.swoosh.rotation.order = "YXZ";
    this.swoosh.rotation.x = -Math.PI / 2;
    this.swoosh.position.y = BAT_H;
    this.inner.add(this.swoosh);

    const add = (m: THREE.Mesh) => { m.rotation.x = -Math.PI / 2; scene.add(m); return m; };
    this.baseRing = add(new THREE.Mesh(G.baseRing, new THREE.MeshBasicMaterial({ color: e.clone().multiplyScalar(1.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));
    this.threat = add(new THREE.Mesh(G.threat, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })));
    this.shadow = add(new THREE.Mesh(G.shadow, new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: softTex, transparent: true, opacity: 0.62, depthWrite: false })));
    this.aim = add(new THREE.Mesh(aimGeo, new THREE.MeshBasicMaterial({ color: e.clone().multiplyScalar(2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
    this.aim.rotation.order = "YXZ";
    this.beam = new THREE.Mesh(G.beam, new THREE.MeshBasicMaterial({ color: e.clone().multiplyScalar(1.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.beam.position.y = HY / 2;
    this.beam.visible = false;
    scene.add(this.beam);
    this.setShown(false);
  }

  setShown(v: boolean) {
    this.shown = v;
    this.g.visible = v;
    this.baseRing.visible = this.shadow.visible = this.aim.visible = v;
    if (!v) { this.threat.visible = false; }
  }

  spawn(x: number, z: number, rt: number) {
    this.ko = null;
    this.spawnT = rt;
    this.beamT = rt;
    this.setShown(true);
    burst({ x, y: 1, z }, 60, { color: this.color, speed: [2, 9], life: [0.3, 0.9], size: [0.06, 0.16], drag: 2, jitter: 0.5 });
    ring({ x, y: 0.06, z }, { color: this.color, normal: UP, from: 0.4, to: 3, life: 0.6, peak: 1 });
  }

  knockOut(x: number, y: number, z: number, d: THREE.Vector3) {
    this.ko = {
      vel: v3(d.x * 16, 9 + Math.abs(d.y) * 4, d.z * 16),
      spin: v3(rand(7, 11), 0, rand(-5, 5)),
      rx: 0, rz: 0, t: 0, x, y, z,
    };
  }

  /** Clear everything for a fresh match. */
  /** Swap the weapon model (players pick a weapon; the seat only sets the colour). */
  setWeapon(kind: string) {
    if (kind === this.weaponKey) return;
    this.swing.remove(this.weaponGroup);
    this.weaponGroup.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    this.weaponGroup = weapon(kind, this.mats.dark, this.mats.body, this.mats.glow, this.color);
    this.weaponGroup.position.x = 0.9;
    this.swing.add(this.weaponGroup);
    this.weaponKey = kind;
  }

  reset() {
    this.ko = null;
    this.setShown(false);
    this.beam.visible = false;
  }

  update(dt: number, rt: number, s: PlayerView | null) {
    if (this.ko) { this.updateKO(dt); return; }
    if (!s || !s.alive) {
      if (this.shown) this.setShown(false);
      this.beam.visible = false;
      return;
    }
    if (!this.shown) this.setShown(true);
    this.pos.set(s.x, s.y, s.z);
    this.facing = s.f;
    this.g.position.set(s.x, s.y + 1, s.z);
    this.g.rotation.set(0, s.f, 0);
    const since = rt - this.spawnT;
    this.g.scale.setScalar(since < 0.4 ? 0.2 + 0.8 * (1 - Math.pow(1 - since / 0.4, 3)) : 1);
    this.g.visible = !s.invuln || Math.floor(rt * 14) % 3 !== 0;

    let o = s.swingAge >= 0 ? s.swingAge / FS : -1;
    if (s.frozen) o = CONTACT;
    let th: number, rz: number, swinging = false;
    if (s.swingKind === 1 && o >= 0 && o <= 1.6) {
      // Bunt: a short upward scoop.
      swinging = true;
      const w = smooth(clamp(o / 0.7, 0, 1));
      th = lerp(0.9, -0.5, w);
      rz = lerp(0.15, 1.05, w);
      if (o > 1) { const r = smooth(clamp((o - 1) / 0.6, 0, 1)); th = lerp(-0.5, POSE_IDLE, r); rz = lerp(1.05, RZ_IDLE, r); }
    } else if (o >= 0 && o <= 1) {
      swinging = true;
      if (o < CONTACT) { const w = o / CONTACT; th = lerp(POSE_WIND, POSE_HIT, w * w); }
      else { const w = (o - CONTACT) / (1 - CONTACT); th = lerp(POSE_HIT, POSE_FOLLOW, 1 - (1 - w) * (1 - w)); }
      rz = 0.1 * (1 - smooth(Math.min(1, o / 0.5)));
    } else if (o > 1 && (o - 1) * FS < RECOVER) {
      swinging = true;
      const w = smooth(((o - 1) * FS) / RECOVER);
      th = lerp(POSE_FOLLOW, POSE_IDLE, w);
      rz = lerp(0, RZ_IDLE, w);
    } else if (s.ready) { th = POSE_WIND; rz = 0.1; }
    else { th = POSE_IDLE + Math.sin(rt * 2 + this.idx) * 0.05; rz = RZ_IDLE; }
    if (swinging) { this.poseTh = th; this.poseRz = rz; }
    else {
      const k = 1 - Math.exp(-dt * 12);
      this.poseTh = lerp(this.poseTh, th, k);
      this.poseRz = lerp(this.poseRz, rz, k);
    }
    this.swing.rotation.set(0, this.poseTh, this.poseRz);
    this.torso.rotation.y = clamp(0.42 * (this.poseTh - 0.2), -1, 0.6);
    const sw = s.swingKind === 0 && o >= 0.15 && o <= 1.05 ? Math.pow(Math.sin(Math.PI * clamp((o - 0.15) / 0.9, 0, 1)), 0.7) : 0;
    this.swoosh.rotation.y = this.poseTh;
    (this.swoosh.material as THREE.MeshBasicMaterial).opacity = sw * 0.9;

    const sp = Math.hypot(s.vx, s.vz);
    if (!s.frozen) {
      this.runAmt = lerp(this.runAmt, clamp(sp / PLAYER.speed, 0, 1), 1 - Math.exp(-dt * 10));
      this.runPhase += dt * (4 + sp * 1.3);
    }
    const air = s.y > 0.05 ? 1 : 0, ra = this.runAmt, ph = Math.sin(this.runPhase);
    this.legs[0].rotation.x = lerp(ph * 0.95 * ra, -0.75, air);
    this.legs[1].rotation.x = lerp(-ph * 0.95 * ra, 0.45, air);
    this.armL.rotation.x = -ph * 0.8 * ra;
    this.armL.rotation.z = -0.15 - (air ? 0.5 : 0);
    this.torso.rotation.x = s.dash ? 0.75 : 0.22 * ra;
    if (s.dash) { this.legs[0].rotation.x = -1.1; this.legs[1].rotation.x = 0.9; }
    this.body.position.y = Math.abs(Math.cos(this.runPhase)) * 0.07 * ra;

    this.baseRing.position.set(s.x, 0.025, s.z);
    this.shadow.position.set(s.x, 0.015, s.z);
    const hf = clamp(s.y / 4, 0, 1);
    this.shadow.scale.setScalar(1 - 0.45 * hf);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.62 * (1 - 0.5 * hf);

    this.aim.visible = s.local;
    if (s.local) {
      this.aim.position.set(s.x + Math.sin(s.f) * 1.25, 0.04, s.z + Math.cos(s.f) * 1.25);
      this.aim.rotation.set(Math.PI / 2, s.f, 0); // order YXZ: lay flat, then point along facing
      (this.aim.material as THREE.MeshBasicMaterial).opacity = s.frozen ? 1 : 0.65;
    }

    this.threat.visible = !!s.threat;
    if (s.threat) {
      this.threat.position.set(s.x, 0.035, s.z);
      (this.threat.material as THREE.MeshBasicMaterial).color.copy(s.threat).multiplyScalar(2.2);
      this.threat.scale.setScalar(1 + 0.14 * Math.sin(rt * 14));
      (this.threat.material as THREE.MeshBasicMaterial).opacity = 0.85;
    }

    const bt = rt - this.beamT;
    this.beam.visible = bt >= 0 && bt < 1;
    if (this.beam.visible) {
      this.beam.position.set(s.x, HY / 2, s.z);
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - bt);
      this.beam.scale.set(1 - 0.6 * bt, 1, 1 - 0.6 * bt);
    }
  }

  updateKO(dt: number) {
    const k = this.ko!;
    this.baseRing.visible = this.shadow.visible = this.aim.visible = false;
    this.threat.visible = false;
    this.beam.visible = false;
    (this.swoosh.material as THREE.MeshBasicMaterial).opacity = 0;
    k.t += dt;
    k.vel.y -= PLAYER.gravity * 0.55 * dt;
    k.x += k.vel.x * dt; k.z += k.vel.z * dt; k.y += k.vel.y * dt;
    if (Math.abs(k.x) > HX - 0.7) { k.x = clamp(k.x, -HX + 0.7, HX - 0.7); k.vel.x *= -0.55; }
    if (Math.abs(k.z) > HZ - 0.7) { k.z = clamp(k.z, -HZ + 0.7, HZ - 0.7); k.vel.z *= -0.55; }
    if (k.y > HY - 2.2) { k.y = HY - 2.2; k.vel.y *= -0.4; }
    if (k.y < 0) { k.y = 0; k.vel.y *= -0.38; k.vel.x *= 0.7; k.vel.z *= 0.7; k.spin.multiplyScalar(0.7); }
    k.rx += k.spin.x * dt; k.rz += k.spin.z * dt;
    this.g.visible = true;
    this.g.scale.setScalar(1);
    this.g.position.set(k.x, k.y + 1, k.z);
    this.g.rotation.set(k.rx, this.facing, k.rz);
    if (k.t > 2.2) {
      burst({ x: k.x, y: k.y + 1, z: k.z }, 70, { color: this.color, speed: [1, 6], life: [0.4, 1], size: [0.06, 0.16], drag: 2, jitter: 0.6, grav: -2 });
      this.ko = null;
      this.setShown(false);
    }
  }
}
