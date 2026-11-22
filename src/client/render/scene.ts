import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { HX, HY, HZ, SLOTS } from "../../shared/constants";

export const TAU = Math.PI * 2;
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
export const approach = (v: number, t: number, d: number) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
export const UP = v3(0, 1, 0);
export const WHITE = new THREE.Color(1, 1, 1);
export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function makeCanvas(w: number, h = w) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
export function canvasTex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowTexture(inner = "rgba(255,255,255,1)", mid = "rgba(255,255,255,.28)") {
  const c = makeCanvas(128), g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, inner); r.addColorStop(0.28, mid); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return canvasTex(c);
}

export function flareTexture() {
  const c = makeCanvas(256), g = c.getContext("2d")!;
  g.translate(128, 128);
  g.globalCompositeOperation = "lighter";
  const r = g.createRadialGradient(0, 0, 0, 0, 0, 60);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.45)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.beginPath(); g.arc(0, 0, 60, 0, TAU); g.fill();
  for (const [a, len, w] of [[0, 124, 7], [Math.PI / 2, 124, 7], [Math.PI / 4, 72, 4], [(3 * Math.PI) / 4, 72, 4]]) {
    g.save(); g.rotate(a);
    const l = g.createLinearGradient(-len, 0, len, 0);
    l.addColorStop(0, "rgba(255,255,255,0)"); l.addColorStop(0.5, "rgba(255,255,255,1)"); l.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = l; g.beginPath(); g.moveTo(-len, 0); g.lineTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w); g.closePath(); g.fill();
    g.restore();
  }
  return canvasTex(c);
}

function wallGridTexture() {
  const c = makeCanvas(128), g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,.95)"; g.lineWidth = 2;
  const e = 4, n = 14;
  g.beginPath();
  g.moveTo(e + n, e); g.lineTo(128 - e - n, e); g.lineTo(128 - e, e + n); g.lineTo(128 - e, 128 - e - n);
  g.lineTo(128 - e - n, 128 - e); g.lineTo(e + n, 128 - e); g.lineTo(e, 128 - e - n); g.lineTo(e, e + n);
  g.closePath(); g.stroke();
  g.fillStyle = "rgba(255,255,255,.9)";
  for (const [x, y] of [[64, 4], [64, 124], [4, 64], [124, 64]]) g.fillRect(x - 2, y - 2, 4, 4);
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ renderer

export const canvas = document.getElementById("c") as HTMLCanvasElement;
export let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch (e) {
  document.getElementById("fallback")!.hidden = false;
  throw e;
}
export const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07060d);
scene.fog = new THREE.FogExp2(0x07060d, 0.0105);

export const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 13, 32);

export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// strength 0.45 (half the concept reel's 0.9), radius 0.55, threshold 0.82
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

// ------------------------------------------------------------------ floor

const FW = 2048, FH = Math.round((2048 * HZ) / HX), U = FW / (2 * HX);
const floorC = makeCanvas(FW, FH), floorE = makeCanvas(FW, FH);
function paintFloor(withText: boolean) {
  const t = floorC.getContext("2d")!, e = floorE.getContext("2d")!;
  const r = t.createRadialGradient(FW / 2, FH / 2, 40, FW / 2, FH / 2, FW * 0.62);
  r.addColorStop(0, "#1b1731"); r.addColorStop(1, "#0b0a14");
  t.fillStyle = r; t.fillRect(0, 0, FW, FH);
  e.fillStyle = "#000"; e.fillRect(0, 0, FW, FH);
  t.lineWidth = 2;
  for (let i = 0; i <= 2 * HX; i++) {
    t.strokeStyle = i % 5 === 0 ? "rgba(200,190,255,.11)" : "rgba(200,190,255,.045)";
    t.beginPath(); t.moveTo(i * U, 0); t.lineTo(i * U, FH); t.stroke();
  }
  for (let i = 0; i <= 2 * HZ; i++) {
    t.strokeStyle = i % 5 === 0 ? "rgba(200,190,255,.11)" : "rgba(200,190,255,.045)";
    t.beginPath(); t.moveTo(0, i * U); t.lineTo(FW, i * U); t.stroke();
  }
  if (withText) {
    t.save();
    t.textAlign = "center"; t.textBaseline = "middle";
    t.font = `900 ${Math.round(4.6 * U)}px "Big Shoulders Display", Impact, sans-serif`;
    t.fillStyle = "rgba(255,255,255,.055)";
    t.translate(FW / 2, (HZ + 6.4) * U);
    t.transform(1, 0, -0.2, 1, 0, 0);
    t.fillText("OVERCLOCK", 0, 0);
    t.restore();
    t.save();
    t.textAlign = "center"; t.textBaseline = "middle";
    t.font = `700 ${Math.round(0.9 * U)}px "Chakra Petch", sans-serif`;
    t.fillStyle = "rgba(255,255,255,.12)";
    t.fillText("ARENA 03  ·  30 × 20 × 12 CUBE", FW / 2, (HZ - 7.6) * U);
    t.restore();
  }
  const lines = (g: CanvasRenderingContext2D, col: string, w: number) => {
    g.strokeStyle = col; g.lineWidth = w;
    const m = 0.6 * U;
    g.strokeRect(m, m, FW - 2 * m, FH - 2 * m);
    g.beginPath(); g.moveTo(FW / 2, m); g.lineTo(FW / 2, FH - m); g.stroke();
    g.beginPath(); g.arc(FW / 2, FH / 2, 3 * U, 0, TAU); g.stroke();
    g.beginPath(); g.arc(FW / 2, FH / 2, 0.4 * U, 0, TAU); g.stroke();
    for (const s of [-1, 1]) {
      const x = FW / 2 + s * 9 * U;
      g.beginPath();
      g.moveTo(x - 0.6 * U, FH / 2); g.lineTo(x + 0.6 * U, FH / 2);
      g.moveTo(x, FH / 2 - 0.6 * U); g.lineTo(x, FH / 2 + 0.6 * U);
      g.stroke();
    }
  };
  lines(t, "rgba(255,92,145,.5)", 5);
  lines(e, "rgba(255,72,132,.95)", 5);
}
paintFloor(false);
const floorTex = canvasTex(floorC), floorEm = canvasTex(floorE);
floorTex.anisotropy = floorEm.anisotropy = renderer.capabilities.getMaxAnisotropy();
document.fonts?.ready.then(() => {
  Promise.all([
    document.fonts.load('900 120px "Big Shoulders Display"'),
    document.fonts.load('700 40px "Chakra Petch"'),
  ]).finally(() => { paintFloor(true); floorTex.needsUpdate = true; floorEm.needsUpdate = true; });
});

scene.add(new THREE.HemisphereLight(0x8f80ff, 0x140b1f, 0.85));
const sun = new THREE.DirectionalLight(0xfff4ee, 1.5);
sun.position.set(-8, 22, 14);
scene.add(sun);
const pinkL = new THREE.PointLight(0xff3d8a, 90, 46, 2);
pinkL.position.set(-HX + 1, HY - 1, -HZ + 1);
scene.add(pinkL);
const blueL = new THREE.PointLight(0x3d7bff, 90, 46, 2);
blueL.position.set(HX - 1, HY - 1, -HZ + 1);
scene.add(blueL);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(2 * HX, 2 * HZ),
  new THREE.MeshStandardMaterial({ map: floorTex, emissiveMap: floorEm, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.38, metalness: 0.3 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: 0x0b0a12, roughness: 0.92, metalness: 0.05 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.03;
scene.add(ground);

// ------------------------------------------------------------------ glass walls

const gridTex = wallGridTexture();
interface Wall { n: THREE.Vector3; c: THREE.Vector3; m: THREE.Mesh; base: number }
const walls: Wall[] = [
  { n: v3(1, 0, 0), c: v3(-HX, HY / 2, 0), w: 2 * HZ, h: HY, rot: [0, Math.PI / 2, 0] },
  { n: v3(-1, 0, 0), c: v3(HX, HY / 2, 0), w: 2 * HZ, h: HY, rot: [0, -Math.PI / 2, 0] },
  { n: v3(0, 0, 1), c: v3(0, HY / 2, -HZ), w: 2 * HX, h: HY, rot: [0, 0, 0] },
  { n: v3(0, 0, -1), c: v3(0, HY / 2, HZ), w: 2 * HX, h: HY, rot: [0, Math.PI, 0] },
  { n: v3(0, -1, 0), c: v3(0, HY, 0), w: 2 * HX, h: 2 * HZ, rot: [Math.PI / 2, 0, 0] },
].map((d) => {
  const t = gridTex.clone();
  t.needsUpdate = true;
  t.repeat.set(d.w / 3, d.h / 3);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(d.w, d.h),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.42, 0.34, 1), map: t, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }),
  );
  m.position.copy(d.c);
  m.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
  scene.add(m);
  return { n: d.n, c: d.c, m, base: d.n.y < 0 ? 0.1 : 0.17 };
});

function tube(a: THREE.Vector3, b: THREE.Vector3, color: THREE.Color, r = 0.05) {
  const d = b.clone().sub(a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6, 1), new THREE.MeshBasicMaterial({ color }));
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  scene.add(m);
}
{
  const low = new THREE.Color(1, 0.22, 0.52).multiplyScalar(2.4);
  const vert = new THREE.Color(0.55, 0.32, 1).multiplyScalar(2);
  const top = new THREE.Color(0.25, 0.6, 1).multiplyScalar(2.2);
  for (const y of [0, HY]) for (const z of [-HZ, HZ]) tube(v3(-HX, y, z), v3(HX, y, z), y ? top : low);
  for (const y of [0, HY]) for (const x of [-HX, HX]) tube(v3(x, y, -HZ), v3(x, y, HZ), y ? top : low);
  for (const x of [-HX, HX]) for (const z of [-HZ, HZ]) tube(v3(x, 0, z), v3(x, HY, z), vert, 0.07);
}

// ------------------------------------------------------------------ crowd

interface Fan { p: THREE.Vector3; ph: number; f: number; k: number; sc: number; li: number }
export const crowd = { excite: 0.2, spots: [] as Fan[], fans: null as unknown as THREE.InstancedMesh, lights: null as unknown as THREE.InstancedMesh };
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x100e1a, roughness: 0.95 });
  const box = (x: number, y: number, z: number, w: number, h: number, d: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    scene.add(m);
  };
  for (let l = 0; l < 5; l++) {
    const c = 3.6 + l * 1.7, h = 0.7 + l * 1.15, u = 1.7;
    box(0, h / 2, -(HZ + c), 2 * (HX + c) + u, h, u);
    const d = HZ + (HZ + c), p = (HZ - (HZ + c)) / 2;
    box(-(HX + c), h / 2, p, u, h, d);
    box(HX + c, h / 2, p, u, h, d);
    const mk = (x: number, z: number) => ({ p: v3(x, h, z), ph: 0, f: 0, k: 0, sc: 1, li: -1 });
    for (let g = -(HX + c); g <= HX + c; g += 0.92) crowd.spots.push(mk(g + rand(-0.2, 0.2), -(HZ + c) + rand(-0.4, 0.4)));
    for (let g = -(HZ + c) + 0.92; g <= HZ - 0.5; g += 0.92) {
      crowd.spots.push(mk(-(HX + c) + rand(-0.4, 0.4), g + rand(-0.2, 0.2)));
      crowd.spots.push(mk(HX + c + rand(-0.4, 0.4), g + rand(-0.2, 0.2)));
    }
  }
  const fans = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.42, 2, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), crowd.spots.length);
  const nLights = crowd.spots.filter(() => Math.random() < 0.18).length;
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), nLights + 8);
  let li = 0;
  const col = new THREE.Color();
  crowd.spots.forEach((s, i) => {
    s.ph = rand(0, TAU); s.f = Math.random(); s.k = rand(0.6, 1.6); s.sc = rand(0.88, 1.12);
    col.setHSL(rand(0.68, 0.78), rand(0.08, 0.25), rand(0.12, 0.24));
    if (Math.random() < 0.12) col.set(pick(SLOTS).color).multiplyScalar(0.35);
    fans.setColorAt(i, col);
    if (li < nLights && Math.random() < 0.2) {
      s.li = li;
      lights.setColorAt(li, new THREE.Color(pick(SLOTS).color).multiplyScalar(2.2));
      li++;
    }
  });
  lights.count = li;
  scene.add(fans, lights);
  crowd.fans = fans;
  crowd.lights = lights;
}

// Light rigs
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x15131f, roughness: 0.7, metalness: 0.4 });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.5, 2.3) });
  for (const [x, z] of [[-(HX + 13), -(HZ + 12)], [HX + 13, -(HZ + 12)], [-(HX + 17), HZ + 2], [HX + 17, HZ + 2]]) {
    const h = HY + 9;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.6, h, 0.6), mat);
    pole.position.set(x, h / 2, z);
    scene.add(pole);
    const head = new THREE.Group();
    head.position.set(x, h, z);
    scene.add(head);
    head.lookAt(0, 2, 0);
    head.add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.9, 0.4), mat));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.62), lamp);
      p.position.set(-1.15 + i * 1.15, -0.4 + j * 0.8, 0.21);
      head.add(p);
    }
  }
}

const dummy = new THREE.Object3D();
export function updateCrowd(dt: number, rt: number) {
  crowd.excite = Math.max(0, crowd.excite - dt * 0.45);
  const ex = 0.1 + crowd.excite;
  for (let i = 0; i < crowd.spots.length; i++) {
    const s = crowd.spots[i];
    const hop = Math.max(0, Math.sin(rt * (5 + s.f * 4) + s.ph)) * 0.34 * Math.min(1, ex * s.k);
    dummy.position.set(s.p.x, s.p.y + 0.41 * s.sc + hop, s.p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(s.sc);
    dummy.updateMatrix();
    crowd.fans.setMatrixAt(i, dummy.matrix);
    if (s.li >= 0) {
      dummy.position.set(s.p.x + Math.sin(rt * 6 + s.ph) * 0.18 * Math.min(1, ex * 1.5), s.p.y + 1.05 * s.sc + hop, s.p.z);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      crowd.lights.setMatrixAt(s.li, dummy.matrix);
    }
  }
  crowd.fans.instanceMatrix.needsUpdate = true;
  crowd.lights.instanceMatrix.needsUpdate = true;
}

const tmp = v3();
export function updateWalls(dt: number) {
  for (const w of walls) {
    tmp.subVectors(camera.position, w.c);
    const side = tmp.dot(w.n);
    const target = w.base * smooth(clamp((side + 1) / 3, 0, 1));
    const mat = w.m.material as THREE.MeshBasicMaterial;
    mat.opacity = approach(mat.opacity, target, dt * 0.8);
  }
}

export function render() {
  composer.render();
}
