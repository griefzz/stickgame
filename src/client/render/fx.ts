import * as THREE from "three";
import { TAU, camera, lerp, pixelRatio, rand, reducedMotion, scene, smooth, v3 } from "./scene";

// ------------------------------------------------------------------ particles

const N = 1600;
const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
const vel = new Float32Array(N * 3), life = new Float32Array(N), life0 = new Float32Array(N), drag = new Float32Array(N), grav = new Float32Array(N), size0 = new Float32Array(N);
let cursor = 0;
const geo = new THREE.BufferGeometry();
const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
const aAlpha = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
geo.setAttribute("position", aPos);
geo.setAttribute("pcol", aCol);
geo.setAttribute("psize", aSize);
geo.setAttribute("palpha", aAlpha);
const pmat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 500 } },
  vertexShader: `attribute vec3 pcol; attribute float psize; attribute float palpha; uniform float uScale; varying vec3 vC; varying float vA;
    void main(){ vC = pcol; vA = palpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = psize * uScale / max(0.2, -mv.z); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vC; varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a; gl_FragColor = vec4(vC * 2.4, vA * a); }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const points = new THREE.Points(geo, pmat);
points.frustumCulled = false;
scene.add(points);

export interface BurstOpts {
  color: THREE.Color;
  speed: [number, number];
  life: [number, number];
  size: [number, number];
  drag?: number;
  grav?: number;
  dir?: THREE.Vector3;
  spread?: number;
  hemi?: THREE.Vector3;
  jitter?: number;
  white?: boolean;
}

export function burst(at: { x: number; y: number; z: number }, count: number, o: BurstOpts) {
  for (let n = 0; n < count; n++) {
    const i = cursor;
    cursor = (cursor + 1) % N;
    const u = Math.random() * 2 - 1, th = Math.random() * TAU, s = Math.sqrt(1 - u * u);
    let x = s * Math.cos(th), y = u, z = s * Math.sin(th);
    if (o.dir) {
      const sp = o.spread ?? 0.5;
      x = o.dir.x + x * sp; y = o.dir.y + y * sp; z = o.dir.z + z * sp;
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
    }
    if (o.hemi) {
      const d = x * o.hemi.x + y * o.hemi.y + z * o.hemi.z;
      if (d < 0) { x -= 2 * d * o.hemi.x; y -= 2 * d * o.hemi.y; z -= 2 * d * o.hemi.z; }
    }
    const sp = rand(o.speed[0], o.speed[1]);
    vel[i * 3] = x * sp; vel[i * 3 + 1] = y * sp; vel[i * 3 + 2] = z * sp;
    const j = o.jitter || 0;
    pos[i * 3] = at.x + rand(-j, j); pos[i * 3 + 1] = at.y + rand(-j, j); pos[i * 3 + 2] = at.z + rand(-j, j);
    const w = o.white && Math.random() < 0.35;
    col[i * 3] = w ? 1 : o.color.r; col[i * 3 + 1] = w ? 1 : o.color.g; col[i * 3 + 2] = w ? 1 : o.color.b;
    life[i] = life0[i] = rand(o.life[0], o.life[1]);
    size0[i] = rand(o.size[0], o.size[1]);
    drag[i] = o.drag ?? 2;
    grav[i] = o.grav ?? 0;
  }
}

function updateParticles(dt: number) {
  for (let i = 0; i < N; i++) {
    if (life[i] <= 0) {
      if (alpha[i] !== 0) { alpha[i] = 0; size[i] = 0; }
      continue;
    }
    life[i] -= dt;
    const k = Math.exp(-drag[i] * dt);
    vel[i * 3] *= k;
    vel[i * 3 + 1] = vel[i * 3 + 1] * k - grav[i] * dt;
    vel[i * 3 + 2] *= k;
    pos[i * 3] += vel[i * 3] * dt;
    pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    if (pos[i * 3 + 1] < 0.03) { pos[i * 3 + 1] = 0.03; vel[i * 3 + 1] *= -0.35; }
    const f = Math.max(0, life[i] / life0[i]);
    alpha[i] = f;
    size[i] = size0[i] * (0.35 + 0.65 * f);
  }
  aPos.needsUpdate = aCol.needsUpdate = aSize.needsUpdate = aAlpha.needsUpdate = true;
}

// ------------------------------------------------------------------ rings

const ringGeo = new THREE.RingGeometry(0.82, 1, 64);
interface Ring { m: THREE.Mesh; t: number; life: number; from: number; to: number; mode: string; bill: boolean; peak: number }
const rings: Ring[] = [];
for (let i = 0; i < 26; i++) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  m.visible = false;
  scene.add(m);
  rings.push({ m, t: 0, life: 1, from: 1, to: 2, mode: "wave", bill: true, peak: 1 });
}
let ringCursor = 0;

export interface RingOpts { color: THREE.Color; from: number; to: number; life: number; mode?: "wave" | "charge"; peak?: number; normal?: THREE.Vector3; boost?: number }
const Z = v3(0, 0, 1);
export function ring(at: { x: number; y: number; z: number }, o: RingOpts): Ring {
  const r = rings[ringCursor];
  ringCursor = (ringCursor + 1) % rings.length;
  r.m.position.set(at.x, at.y, at.z);
  r.t = 0; r.life = o.life; r.from = o.from; r.to = o.to; r.mode = o.mode || "wave"; r.peak = o.peak ?? 1;
  r.bill = !o.normal;
  if (o.normal) r.m.quaternion.setFromUnitVectors(Z, o.normal);
  (r.m.material as THREE.MeshBasicMaterial).color.copy(o.color).multiplyScalar(o.boost ?? 2.2);
  r.m.scale.setScalar(o.from);
  (r.m.material as THREE.MeshBasicMaterial).opacity = 0;
  r.m.visible = true;
  return r;
}
export function killRing(r: Ring | null) { if (r) r.m.visible = false; }

function updateRings(dt: number) {
  for (const r of rings) {
    if (!r.m.visible) continue;
    r.t += dt;
    const e = r.t / r.life;
    if (e >= 1) { r.m.visible = false; continue; }
    let s: number, a: number;
    if (r.mode === "charge") { s = lerp(r.from, r.to, smooth(e)); a = r.peak * Math.pow(e, 0.6); }
    else { s = lerp(r.from, r.to, 1 - Math.pow(1 - e, 3)); a = r.peak * (1 - e) * (1 - e); }
    r.m.scale.setScalar(s);
    (r.m.material as THREE.MeshBasicMaterial).opacity = a;
    if (r.bill) r.m.quaternion.copy(camera.quaternion);
  }
}

// ------------------------------------------------------------------ screen flash

const flashEl = document.getElementById("flash") as HTMLDivElement;
export function flash(color: string, amount: number) {
  if (reducedMotion) return;
  flashEl.style.transition = "none";
  flashEl.style.background = color;
  flashEl.style.opacity = String(amount);
  void flashEl.offsetWidth;
  flashEl.style.transition = "opacity .45s ease-out";
  flashEl.style.opacity = "0";
}

export function updateFx(dt: number) {
  updateParticles(dt);
  updateRings(dt);
  pmat.uniforms.uScale.value = (window.innerHeight * pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
}
