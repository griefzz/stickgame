import * as THREE from "three";
import { BALL_R, HY } from "../../shared/constants";
import { advanceBall, newKin, type BallKin } from "../../shared/ball";
import { WHITE, camera, clamp, flareTexture, glowTexture, scene, v3 } from "./scene";

const glowTex = glowTexture();
const softTex = glowTexture("rgba(255,255,255,1)", "rgba(255,255,255,.55)");

const core = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTexture(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
flare.renderOrder = 5;
const light = new THREE.PointLight(0xffffff, 0, 18, 2);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: softTex, transparent: true, opacity: 0.6, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
// Marker on the floor under the ball: a dark band (so it reads on top of bright floor lines),
// a bright ring and centre dot in the ball's colour, and a thin glowing post up to the ball.
const additive = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const groundHalo = new THREE.Mesh(new THREE.RingGeometry(0.48, 1.0, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
const groundRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.84, 48), additive());
const groundDot = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), additive());
for (const m of [groundHalo, groundRing, groundDot]) m.rotation.x = -Math.PI / 2;
groundHalo.renderOrder = 1;
groundRing.renderOrder = groundDot.renderOrder = 2;
const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8).translate(0, 0.5, 0), additive());
scene.add(core, glow, flare, light, shadow, groundHalo, groundRing, groundDot, drop);

// ------------------------------------------------------------------ trail ribbon

const TN = 180;
export const trail: { p: THREE.Vector3; t: number }[] = [];
const tPos = new Float32Array(TN * 2 * 3), tA = new Float32Array(TN * 2);
const tGeo = new THREE.BufferGeometry();
const tPosA = new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage);
const tAA = new THREE.BufferAttribute(tA, 1).setUsage(THREE.DynamicDrawUsage);
tGeo.setAttribute("position", tPosA);
tGeo.setAttribute("alpha", tAA);
{
  const idx: number[] = [];
  for (let i = 0; i < TN - 1; i++) { const e = 2 * i; idx.push(e, e + 1, e + 2, e + 1, e + 3, e + 2); }
  tGeo.setIndex(idx);
}
const tMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uBoost: { value: 2.6 } },
  vertexShader: "attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: "uniform vec3 uColor; uniform float uBoost; varying float vA; void main(){ gl_FragColor = vec4(uColor * uBoost * vA, vA); }",
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const tMesh = new THREE.Mesh(tGeo, tMat);
tMesh.frustumCulled = false;
scene.add(tMesh);

export function pushTrail(x: number, y: number, z: number, t: number) {
  trail.unshift({ p: v3(x, y, z), t });
  if (trail.length > TN) trail.length = TN;
}
export function clearTrail() { trail.length = 0; }

const side = v3(), toCam = v3(), nrm = v3();
function updateTrail(now: number, speedFrac: number, color: THREE.Color, scale: number) {
  while (trail.length && now - trail[trail.length - 1].t > 0.28) trail.pop();
  const maxLen = 2.5 + 16 * speedFrac;
  let len = 0, n = Math.min(trail.length, TN);
  for (let i = 1; i < n; i++) {
    len += trail[i].p.distanceTo(trail[i - 1].p);
    if (len > maxLen) { n = i + 1; break; }
  }
  trail.length = Math.min(trail.length, n);
  if (n < 2 || scale < 0.05) { tGeo.setDrawRange(0, 0); return; }
  tMat.uniforms.uColor.value.copy(color);
  const w = BALL_R * (0.55 + 0.75 * speedFrac);
  let had = false;
  for (let i = 0; i < n; i++) {
    const a = trail[Math.max(0, i - 1)].p, b = trail[Math.min(n - 1, i + 1)].p, p = trail[i].p;
    side.subVectors(a, b);
    toCam.subVectors(camera.position, p);
    side.cross(toCam);
    if (side.lengthSq() > 1e-8) { nrm.copy(side).normalize(); had = true; } else if (!had) nrm.set(0, 1, 0);
    const u = i / (n - 1), d = w * Math.pow(1 - u, 0.6);
    tPos[i * 6] = p.x + nrm.x * d; tPos[i * 6 + 1] = p.y + nrm.y * d; tPos[i * 6 + 2] = p.z + nrm.z * d;
    tPos[i * 6 + 3] = p.x - nrm.x * d; tPos[i * 6 + 4] = p.y - nrm.y * d; tPos[i * 6 + 5] = p.z - nrm.z * d;
    tA[i * 2] = tA[i * 2 + 1] = Math.pow(1 - u, 1.4) * 0.95;
  }
  tPosA.needsUpdate = true;
  tAA.needsUpdate = true;
  tGeo.setDrawRange(0, (n - 1) * 6);
}

// ------------------------------------------------------------------ aim telegraph (dotted path)

const DOTS = 90;
const dPos = new Float32Array(DOTS * 3), dA = new Float32Array(DOTS);
const dGeo = new THREE.BufferGeometry();
const dPosA = new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage);
const dAA = new THREE.BufferAttribute(dA, 1).setUsage(THREE.DynamicDrawUsage);
dGeo.setAttribute("position", dPosA);
dGeo.setAttribute("alpha", dAA);
const dMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uScale: { value: 500 } },
  vertexShader: "attribute float alpha; uniform float uScale; varying float vA; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = 0.16 * uScale / max(0.2, -mv.z); gl_Position = projectionMatrix * mv; }",
  fragmentShader: "uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.1, d); gl_FragColor = vec4(uColor * 2.2, vA * a); }",
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const dots = new THREE.Points(dGeo, dMat);
dots.frustumCulled = false;
scene.add(dots);

const kin: BallKin = newKin();
export function setTelegraph(on: boolean, from?: { x: number; y: number; z: number }, dir?: { x: number; y: number; z: number; cv?: number; ct?: number; ar?: number }, color?: THREE.Color, strength = 1, rt = 0) {
  if (!on || !from || !dir || !color) { dGeo.setDrawRange(0, 0); return; }
  dMat.uniforms.uColor.value.copy(color);
  dMat.uniforms.uScale.value = (window.innerHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(window.devicePixelRatio || 1, 1.75);
  kin.x = from.x; kin.y = from.y; kin.z = from.z;
  const step = 0.5;
  kin.vx = dir.x * step; kin.vy = dir.y * step; kin.vz = dir.z * step;
  kin.lob = false; kin.cv = dir.cv ?? 0; kin.ct = dir.ct ?? 0; kin.ar = dir.ar ?? 0; // curve shots draw a bending line
  let bounces = 0;
  const flow = (rt * 6) % 1;
  // Start the dots a little ahead so they flow outward.
  advanceBall(kin, flow);
  let n = 0;
  for (; n < DOTS; n++) {
    advanceBall(kin, 1, () => { bounces++; });
    if (bounces > 2) break;
    dPos[n * 3] = kin.x; dPos[n * 3 + 1] = kin.y; dPos[n * 3 + 2] = kin.z;
    const fade = 1 - n / DOTS;
    dA[n] = strength * (0.35 + 0.65 * fade) * (bounces ? 0.55 : 1);
  }
  dPosA.needsUpdate = true;
  dAA.needsUpdate = true;
  dGeo.setDrawRange(0, n);
}

// ------------------------------------------------------------------ ball update

export interface BallView {
  visible: boolean;
  x: number; y: number; z: number;
  color: THREE.Color;
  speedFrac: number;
  frozen: boolean;
  bigFreeze: boolean;
  charge?: number;     // 0..1 while the hitter holds a charge
}

let scale = 0;
export function updateBall(dt: number, rt: number, now: number, s: BallView) {
  scale = s.visible ? Math.min(1, scale + dt * 5) : Math.max(0, scale - dt * 6);
  const vis = scale > 0.01;
  core.visible = glow.visible = shadow.visible = groundHalo.visible = groundRing.visible = groundDot.visible = drop.visible = vis;
  const c = s.color, sf = s.speedFrac, fr = s.frozen;
  const ch = s.charge ?? 0;
  const pulse = fr ? (1 + 0.3 * Math.sin(rt * (38 + 30 * ch))) * (1 + 1.2 * ch) : 1;
  core.position.set(s.x, s.y, s.z);
  core.scale.setScalar(scale * (fr ? 1.12 : 1));
  (core.material as THREE.MeshBasicMaterial).color.copy(c).lerp(WHITE, 0.55).multiplyScalar(3.2);
  glow.position.copy(core.position);
  glow.scale.setScalar(scale * (1.8 + sf * 2.4) * pulse);
  glow.material.color.copy(c).multiplyScalar(1.1 + sf * 1.6);
  light.position.copy(core.position);
  light.color.copy(c);
  light.intensity = vis ? (6 + 26 * sf) * scale * (fr ? 1.6 : 1) : 0;
  const fl = fr && s.bigFreeze && vis;
  flare.visible = fl;
  if (fl) {
    flare.position.copy(core.position);
    flare.scale.setScalar((1.6 + sf * 5) * (1 + 1.5 * ch) * (0.85 + 0.15 * Math.sin(rt * 30)));
    flare.material.rotation = rt * 1.6;
    flare.material.color.copy(c).multiplyScalar(1.6);
  }
  const h = clamp(s.y / HY, 0, 1);
  shadow.position.set(s.x, 0.02, s.z);
  shadow.scale.setScalar((1.1 - h * 0.5) * scale);
  (shadow.material as THREE.MeshBasicMaterial).opacity = 0.65 - h * 0.35;
  // The marker grows a little with the ball's height, so a high ball still shows where it is.
  const ms = (1 + 0.35 * h) * scale;
  groundHalo.position.set(s.x, 0.025, s.z);
  groundHalo.scale.setScalar(ms);
  (groundHalo.material as THREE.MeshBasicMaterial).opacity = 0.55 * scale;
  groundRing.position.set(s.x, 0.035, s.z);
  groundRing.scale.setScalar(ms);
  (groundRing.material as THREE.MeshBasicMaterial).color.copy(c).multiplyScalar(2.2);
  (groundRing.material as THREE.MeshBasicMaterial).opacity = (0.8 + 0.2 * sf) * scale;
  groundDot.position.set(s.x, 0.035, s.z);
  groundDot.scale.setScalar(scale);
  (groundDot.material as THREE.MeshBasicMaterial).color.copy(c).multiplyScalar(2.2);
  (groundDot.material as THREE.MeshBasicMaterial).opacity = 0.9 * scale;
  drop.position.set(s.x, 0.035, s.z);
  drop.scale.set(scale, Math.max(0.001, s.y - BALL_R - 0.035), scale);
  (drop.material as THREE.MeshBasicMaterial).color.copy(c).multiplyScalar(1.6);
  (drop.material as THREE.MeshBasicMaterial).opacity = 0.5 * scale;
  updateTrail(now, sf, c, scale);
}
