import * as THREE from "three";
import { approach, camera, currentArena, lerp, reducedMotion, smooth, v3 } from "./scene";

// Players always get the arena camera (fixed angle, so controls stay predictable).
// Spectators can switch to the director camera: a slow broadcast orbit that punches in
// on big hits and K.O.s, like the concept reel.
export type CamMode = "arena" | "director";

const rig = {
  mode: "arena" as CamMode,
  pos: v3(0, 13, 32),
  look: v3(0, 4, 0),
  fov: 42,
  trauma: 0,
  focusW: 0,
  focus: null as null | { kind: "ko" | "hit"; p: THREE.Vector3; d: THREE.Vector3; until: number; start: number },
};

export function setCamMode(m: CamMode) {
  if (m === rig.mode) return;
  rig.mode = m;
  if (m === "arena" && rig.focus?.kind === "hit") rig.focus = null;
}
export function camMode() { return rig.mode; }
export function shake(a: number) { rig.trauma = Math.min(1, rig.trauma + a); }

/** K.O. close-up (both cameras; the ball is out of play while it runs). */
export function koFocus(p: THREE.Vector3, rt: number, dur: number) {
  if (reducedMotion) return;
  rig.focus = { kind: "ko", p: p.clone(), d: v3(0, 0, 1), until: rt + dur, start: rt };
}
/** Big-hit close-up beside the ball (director camera only). */
export function hitFocus(p: THREE.Vector3, dir: THREE.Vector3, rt: number, dur: number) {
  if (rig.mode !== "director" || reducedMotion) return;
  if (rig.focus?.kind === "ko" && rt < rig.focus.until) return;
  rig.focus = { kind: "hit", p: p.clone(), d: dir.clone().normalize(), until: rt + dur, start: rt };
}
export function cancelFocus() { rig.focus = null; }

const tPos = v3(), tLook = v3(), kPos = v3(), kLook = v3(), d = v3(), side = v3();
const UP = v3(0, 1, 0);
export function updateCamera(dt: number, rt: number, ball: { x: number; y: number; z: number; on: boolean }, me: { x: number; z: number } | null) {
  rig.trauma = Math.max(0, rig.trauma - dt * 1.4);
  const aspect = camera.aspect;
  const ar = currentArena();
  // Wider or deeper arenas than the 30 x 20 box pull the camera back to keep it all in view.
  const dist = 31 * Math.pow(Math.max(1, 1.45 / aspect), 0.85) * Math.max(1, ar.hx / 15) + Math.max(0, ar.hz - 10) * 1.25;
  const bx = ball.on ? ball.x : 0, by = ball.on ? ball.y : 3, bz = ball.on ? ball.z : 0;
  let fov = 42, rate = 3.2;
  if (rig.mode === "arena") {
    const mx = me ? me.x : 0, mz = me ? me.z : 0;
    tLook.set(bx * 0.26 + mx * 0.1, 3.3 + by * 0.15, bz * 0.18 + mz * 0.08);
    tPos.set(tLook.x * 0.45, 14, dist);
  } else {
    // Director: drift around the arena on slow overlapping sines, following the ball.
    const u = 0.62 * Math.sin(rt * 0.055) + 0.22 * Math.sin(rt * 0.021 + 1.3);
    const h = 12.5 + 2.5 * Math.sin(rt * 0.043);
    tPos.set(Math.sin(u) * dist, h, Math.cos(u) * dist);
    tLook.set(bx * 0.32, 3.4 + by * 0.18, bz * 0.22);
  }
  const f = rig.focus;
  const on = f && rt < f.until ? 1 : 0;
  rig.focusW = approach(rig.focusW, on, dt * (on ? 6 : 1.8));
  if (rig.focusW > 0.001 && f) {
    const w = smooth(rig.focusW), p = f.p;
    if (f.kind === "ko") {
      // Slow orbit around the K.O.
      d.set(tPos.x - p.x, 0, tPos.z - p.z).normalize();
      const ang = Math.atan2(d.x, d.z) + (rt - f.start) * 0.25;
      kLook.copy(p);
      kPos.set(p.x + Math.sin(ang) * 9.5, p.y + 3.2, p.z + Math.cos(ang) * 9.5);
      fov = lerp(fov, 38, w);
    } else {
      // Beside the ball, looking along the shot.
      side.crossVectors(f.d, UP);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      if (side.x * (tPos.x - p.x) + side.z * (tPos.z - p.z) < 0) side.negate();
      kLook.copy(p).addScaledVector(f.d, 1.5);
      kPos.copy(p).addScaledVector(side, 7.2).addScaledVector(f.d, -2.6);
      kPos.y = Math.max(1.2, p.y + 1.7);
      fov = lerp(fov, 32, w);
    }
    tPos.lerp(kPos, w);
    tLook.lerp(kLook, w);
    rate = lerp(3.2, 8.5, w);
  }
  const k = 1 - Math.exp(-dt * rate);
  rig.pos.lerp(tPos, k);
  rig.look.lerp(tLook, k);
  rig.fov = lerp(rig.fov, fov, k);
  const s = rig.trauma * rig.trauma * (reducedMotion ? 0.15 : 1) * 0.85;
  const a = (Math.sin(rt * 37.1) + Math.sin(rt * 23.3 + 1.7)) * 0.5 * s;
  const b = (Math.sin(rt * 41.7 + 0.4) + Math.sin(rt * 19.9 + 2.2)) * 0.5 * s;
  const c = (Math.sin(rt * 33.3 + 2.9) + Math.sin(rt * 27.1 + 0.3)) * 0.5 * s;
  camera.position.set(rig.pos.x + a, rig.pos.y + b, rig.pos.z + c);
  camera.lookAt(rig.look.x + a * 0.4, rig.look.y + b * 0.4, rig.look.z + c * 0.4);
  if (Math.abs(camera.fov - rig.fov) > 0.01) { camera.fov = rig.fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}

// Spectator preference: director camera on or off (remembered between visits).
let wantDirector = false;
try { wantDirector = localStorage.getItem("oc.director") === "1"; } catch {}
export function directorPref() { return wantDirector; }
export function setDirectorPref(on: boolean) {
  wantDirector = on;
  try { localStorage.setItem("oc.director", on ? "1" : "0"); } catch {}
}
