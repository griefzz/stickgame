import * as THREE from "three";
import { approach, camera, lerp, reducedMotion, smooth, v3 } from "./scene";

export type CamMode = "arena" | "side" | "top";
export const CAM_MODES: CamMode[] = ["arena", "side", "top"];
export const CAM_LABEL: Record<CamMode, string> = { arena: "Arena", side: "Side 2D", top: "Overhead" };

const rig = {
  mode: "arena" as CamMode,
  pos: v3(0, 13, 32),
  look: v3(0, 4, 0),
  fov: 42,
  trauma: 0,
  focusW: 0,
  ko: null as null | { p: THREE.Vector3; until: number; start: number },
};

export function setCamMode(m: CamMode) { rig.mode = m; }
export function camMode() { return rig.mode; }
export function shake(a: number) { rig.trauma = Math.min(1, rig.trauma + a); }
export function koFocus(p: THREE.Vector3, rt: number, dur: number) {
  if (rig.mode !== "arena" || reducedMotion) return;
  rig.ko = { p: p.clone(), until: rt + dur, start: rt };
}
export function cancelFocus() { rig.ko = null; }

const tPos = v3(), tLook = v3(), kPos = v3(), kLook = v3(), d = v3();
export function updateCamera(dt: number, rt: number, ball: { x: number; y: number; z: number; on: boolean }, me: { x: number; z: number } | null) {
  rig.trauma = Math.max(0, rig.trauma - dt * 1.4);
  const aspect = camera.aspect;
  let fov = 42, rate = 3.2;
  if (rig.mode === "arena") {
    const dist = 31 * Math.pow(Math.max(1, 1.45 / aspect), 0.85);
    const bx = ball.on ? ball.x : 0, by = ball.on ? ball.y : 3, bz = ball.on ? ball.z : 0;
    const mx = me ? me.x : 0, mz = me ? me.z : 0;
    tLook.set(bx * 0.26 + mx * 0.1, 3.3 + by * 0.15, bz * 0.18 + mz * 0.08);
    tPos.set(tLook.x * 0.45, 14, dist);
    const on = rig.ko && rt < rig.ko.until ? 1 : 0;
    rig.focusW = approach(rig.focusW, on, dt * (on ? 5 : 1.8));
    if (rig.focusW > 0.001 && rig.ko) {
      const w = smooth(rig.focusW), f = rig.ko.p;
      d.set(tPos.x - f.x, 0, tPos.z - f.z).normalize();
      const ang = Math.atan2(d.x, d.z) + (rt - rig.ko.start) * 0.25;
      kLook.copy(f);
      kPos.set(f.x + Math.sin(ang) * 9.5, f.y + 3.2, f.z + Math.cos(ang) * 9.5);
      tPos.lerp(kPos, w);
      tLook.lerp(kLook, w);
      fov = lerp(fov, 38, w);
      rate = lerp(3.2, 8.5, w);
    }
  } else if (rig.mode === "side") {
    const u = Math.tan(THREE.MathUtils.degToRad(9));
    const dist = Math.max(8 / u, 17 / (u * aspect));
    tPos.set(0, 6, dist); tLook.set(0, 5.6, 0); fov = 18; rate = 3;
  } else {
    const u = Math.tan(THREE.MathUtils.degToRad(23));
    const dist = Math.max(12 / u, 17 / (u * aspect));
    tPos.set(0, dist * 0.94, dist * 0.34); tLook.set(0, 0, 0.6); fov = 46; rate = 3;
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

/** Ground-plane yaw of the camera, used to make movement camera-relative. */
export function camYaw(): number {
  return Math.atan2(camera.position.x - rig.look.x, camera.position.z - rig.look.z);
}
