import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { HX, HY, HZ, SLOTS } from "../../shared/constants";
import { ARENAS, arenaOf, standOutline, type Arena } from "../../shared/arena";

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

// ------------------------------------------------------------------ lights + ground (every arena)

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
const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: 0x0b0a12, roughness: 0.92, metalness: 0.05 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.03;
scene.add(ground);

// ------------------------------------------------------------------ arena (rebuilt for each shape)

const gridTex = wallGridTexture();
const dummy = new THREE.Object3D();
interface Glass { n: THREE.Vector3; c: THREE.Vector3; mat: THREE.MeshBasicMaterial; base: number }
interface Fan { p: THREE.Vector3; ph: number; f: number; k: number; sc: number; li: number }
export const crowd = { excite: 0.2, spots: [] as Fan[], fans: null as THREE.InstancedMesh | null, lights: null as THREE.InstancedMesh | null };
let glass: Glass[] = [];
let arenaGroup: THREE.Group | null = null;
let arenaIdx = -1;
let fontsReady = false;
let floorPaint: (() => void) | null = null;

export function currentArena(): Arena { return arenaOf(Math.max(0, arenaIdx)); }

/** Corners of the arena outline moved inwards by `inset` (negative = outwards). */
function insetVerts(a: Arena, inset: number): [number, number][] {
  if (a.radius > 0) {
    const r = (a.radius - inset) / Math.cos(Math.PI / a.verts.length), n = a.verts.length;
    return a.verts.map((_, k) => {
      const ang = (k * 2 * Math.PI) / n + Math.PI / n;
      return [r * Math.sin(ang), r * Math.cos(ang)] as [number, number];
    });
  }
  const W = a.walls, n = W.length;
  return W.map((_, k) => {
    // Corner k joins wall k-1 and wall k.
    const p = W[(k - 1 + n) % n], q = W[k];
    const d1 = p.d - inset, d2 = q.d - inset;
    const det = p.nx * q.nz - p.nz * q.nx;
    return [(d1 * q.nz - d2 * p.nz) / det, (p.nx * d2 - q.nx * d1) / det] as [number, number];
  });
}

function outlinePath(g: CanvasRenderingContext2D, a: Arena, inset: number, toC: (x: number, z: number) => [number, number], U: number, scale = 1) {
  g.beginPath();
  if (a.radius > 0) {
    const [cx, cy] = toC(0, 0);
    g.arc(cx, cy, (a.radius - inset) * scale * U, 0, TAU);
  } else {
    insetVerts(a, inset).forEach(([x, z], i) => {
      const [cx, cy] = toC(x * scale, z * scale);
      if (i) g.lineTo(cx, cy); else g.moveTo(cx, cy);
    });
  }
  g.closePath();
}

function makeFloor(a: Arena) {
  const FW = 2048, FH = Math.round((FW * a.hz) / a.hx), U = FW / (2 * a.hx);
  const c = makeCanvas(FW, FH), ce = makeCanvas(FW, FH);
  const toC = (x: number, z: number): [number, number] => [(x + a.hx) * U, (z + a.hz) * U];
  const paint = () => {
    const t = c.getContext("2d")!, e = ce.getContext("2d")!;
    t.clearRect(0, 0, FW, FH);
    e.fillStyle = "#000"; e.fillRect(0, 0, FW, FH);
    t.save();
    outlinePath(t, a, 0, toC, U);
    t.clip();
    const r = t.createRadialGradient(FW / 2, FH / 2, 40, FW / 2, FH / 2, FW * 0.62);
    r.addColorStop(0, "#1b1731"); r.addColorStop(1, "#0b0a14");
    t.fillStyle = r; t.fillRect(0, 0, FW, FH);
    t.lineWidth = 2;
    for (let i = -Math.ceil(a.hx); i <= Math.ceil(a.hx); i++) {
      t.strokeStyle = i % 5 === 0 ? "rgba(200,190,255,.11)" : "rgba(200,190,255,.045)";
      const [x] = toC(i, 0);
      t.beginPath(); t.moveTo(x, 0); t.lineTo(x, FH); t.stroke();
    }
    for (let i = -Math.ceil(a.hz); i <= Math.ceil(a.hz); i++) {
      t.strokeStyle = i % 5 === 0 ? "rgba(200,190,255,.11)" : "rgba(200,190,255,.045)";
      const [, y] = toC(0, i);
      t.beginPath(); t.moveTo(0, y); t.lineTo(FW, y); t.stroke();
    }
    if (fontsReady) {
      t.textAlign = "center"; t.textBaseline = "middle";
      t.save();
      t.font = `900 ${Math.round(4.6 * U)}px "Big Shoulders Display", Impact, sans-serif`;
      t.fillStyle = "rgba(255,255,255,.055)";
      const [ox, oy] = toC(0, a.hz * 0.64);
      t.translate(ox, oy);
      t.transform(1, 0, -0.2, 1, 0, 0);
      t.fillText("OVERCLOCK", 0, 0);
      t.restore();
      t.font = `700 ${Math.round(0.9 * U)}px "Chakra Petch", sans-serif`;
      t.fillStyle = "rgba(255,255,255,.12)";
      const [sx, sy] = toC(0, -a.hz * 0.76);
      const label = a.key === "box" ? "ARENA 03  ·  30 × 20 × 12 CUBE" : `ARENA ${a.name.toUpperCase()}  ·  ${a.top} M HIGH`;
      t.fillText(label, sx, sy);
    }
    t.restore();
    const blockPath = (g: CanvasRenderingContext2D, b: Arena["blocks"][number]) => {
      g.beginPath();
      if (b.kind === "rect") {
        const [x0, y0] = toC(b.x0, b.z0), [x1, y1] = toC(b.x1, b.z1);
        g.rect(x0, y0, x1 - x0, y1 - y0);
      } else {
        const [cx, cy] = toC(b.x, b.z);
        g.arc(cx, cy, b.r * U, 0, TAU);
      }
    };
    for (const b of a.blocks) { blockPath(t, b); t.fillStyle = "#06050b"; t.fill(); }
    const lines = (g: CanvasRenderingContext2D, col: string, w: number) => {
      g.strokeStyle = col; g.lineWidth = w;
      if (a.shell?.kind === "roundbox") {
        // Rounded box: mark where the flat floor ends and the curve begins.
        const fx = a.shell.hx - a.shell.r, fz = a.shell.hz - a.shell.r;
        const [x0, y0] = toC(-fx, -fz), [x1, y1] = toC(fx, fz);
        g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0);
      } else outlinePath(g, a, 0.6, toC, U);
      g.stroke();
      for (const b of a.blocks) { blockPath(g, b); g.stroke(); }
      const [cx, cy] = toC(0, 0);
      g.beginPath(); g.arc(cx, cy, 3 * U, 0, TAU); g.stroke();
      g.beginPath(); g.arc(cx, cy, 0.4 * U, 0, TAU); g.stroke();
      if (a.key === "box") {
        const [, top] = toC(0, -a.hz + 0.6), [, bot] = toC(0, a.hz - 0.6);
        g.beginPath(); g.moveTo(cx, top); g.lineTo(cx, bot); g.stroke();
        for (const s of [-1, 1]) {
          const x = cx + s * 9 * U;
          g.beginPath();
          g.moveTo(x - 0.6 * U, cy); g.lineTo(x + 0.6 * U, cy);
          g.moveTo(x, cy - 0.6 * U); g.lineTo(x, cy + 0.6 * U);
          g.stroke();
        }
      } else {
        // A smaller echo of the outline marks the centre court.
        outlinePath(g, a, 0, toC, U, 0.42);
        g.stroke();
      }
    };
    lines(t, "rgba(255,92,145,.5)", 5);
    lines(e, "rgba(255,72,132,.95)", 5);
  };
  paint();
  const map = canvasTex(c), em = canvasTex(ce);
  map.anisotropy = em.anisotropy = renderer.capabilities.getMaxAnisotropy();
  floorPaint = () => { paint(); map.needsUpdate = true; em.needsUpdate = true; };
  return { map, em };
}

/** Flat shape of the arena in the floor plane. uvBox: UVs span the bounding box (else metres). */
function arenaShapeGeometry(a: Arena, uvBox: boolean): THREE.BufferGeometry {
  if (a.key === "box") return new THREE.PlaneGeometry(2 * a.hx, 2 * a.hz);
  const shape = new THREE.Shape();
  if (a.radius > 0) shape.absarc(0, 0, a.radius, 0, TAU, false);
  else {
    // Shape space is (x, -z): the mesh is laid flat with rotation.x = -PI/2.
    let pts = a.verts.map(([x, z]) => new THREE.Vector2(x, -z));
    if (THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
    shape.setFromPoints(pts);
  }
  const g = new THREE.ShapeGeometry(shape, 64);
  if (uvBox) {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + a.hx) / (2 * a.hx), (p.getY(i) + a.hz) / (2 * a.hz));
    uv.needsUpdate = true;
  }
  return g;
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture && v !== gridTex) v.dispose();
      mat.dispose();
    }
  });
}

function glassMat(rx: number, ry: number) {
  const t = gridTex.clone();
  t.needsUpdate = true;
  t.repeat.set(rx, ry);
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.42, 0.34, 1), map: t, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
}

const neon = {
  low: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.22, 0.52).multiplyScalar(2.4) }),
  top: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.6, 1).multiplyScalar(2.2) }),
  vert: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.32, 1).multiplyScalar(2) }),
};

function tube(G: THREE.Group, ax: number, ay: number, az: number, bx: number, by: number, bz: number, mat: THREE.Material, r = 0.05) {
  const d = v3(bx - ax, by - ay, bz - az), len = d.length();
  if (len < 1e-4) return;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6, 1), mat);
  m.position.set(ax, ay, az).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  G.add(m);
}

/** A smooth neon tube through 3D points. */
function curveTube(G: THREE.Group, pts: THREE.Vector3[], mat: THREE.Material, r = 0.05, closed = false) {
  const c = new THREE.CatmullRomCurve3(pts, closed);
  G.add(new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(16, pts.length * 3), r, 6, closed), mat));
}

/** Polyline loop through floor-plan points at height y. */
function loop(G: THREE.Group, pts: [number, number][], y: number, mat: THREE.Material, r = 0.05) {
  pts.forEach(([x, z], i) => { const [x2, z2] = pts[(i + 1) % pts.length]; tube(G, x, y, z, x2, y, z2, mat, r); });
}

/** Flat floor-plan arenas: vertical glass walls, a glass roof, neon outlines and posts. */
function buildWalls(G: THREE.Group, a: Arena) {
  const H = a.top;
  for (const w of a.walls) {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    const mat = glassMat(len / 3, H / 3);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), mat);
    m.position.set((w.ax + w.bx) / 2, H / 2, (w.az + w.bz) / 2);
    m.rotation.y = Math.atan2(-w.nx, -w.nz);
    G.add(m);
    glass.push({ n: v3(-w.nx, 0, -w.nz), c: m.position.clone(), mat, base: 0.17 });
  }
  {
    const isBox = a.key === "box";
    // Box roof UVs are 0..1 across the plane; shaped roofs use metres.
    const mat = glassMat(isBox ? (2 * a.hx) / 3 : 1 / 3, isBox ? (2 * a.hz) / 3 : 1 / 3);
    const roof = new THREE.Mesh(arenaShapeGeometry(a, false), mat);
    roof.rotation.x = -Math.PI / 2;
    roof.position.y = H;
    G.add(roof);
    glass.push({ n: v3(0, -1, 0), c: v3(0, H, 0), mat, base: a.view === "top" ? 0.035 : 0.1 });
  }
  const low = neon.low(), top = neon.top(), vert = neon.vert();
  for (const w of a.walls) {
    tube(G, w.ax, 0, w.az, w.bx, 0, w.bz, low);
    tube(G, w.ax, H, w.az, w.bx, H, w.bz, top);
  }
  const postEvery = a.radius > 0 ? 6 : 1;
  a.verts.forEach(([x, z], i) => { if (i % postEvery === 0) tube(G, x, 0, z, x, H, z, vert, 0.07); });
}

/** Glass sphere cut by the floor, in lunes so the side facing the camera can fade. */
function buildSphere(G: THREE.Group, a: Arena, s: { cy: number; r: number }) {
  const N = 12, th = Math.acos(-s.cy / s.r);
  for (let k = 0; k < N; k++) {
    const p0 = (k * TAU) / N, pm = p0 + Math.PI / N;
    const mat = glassMat((s.r * TAU) / N / 3, (s.r * th) / 3);
    const m = new THREE.Mesh(new THREE.SphereGeometry(s.r, 8, 30, p0, TAU / N, 0, th), mat);
    m.position.y = s.cy;
    G.add(m);
    // SphereGeometry puts azimuth phi at (-cos phi, sin phi) in x/z.
    glass.push({ n: v3(Math.cos(pm), 0, -Math.sin(pm)), c: v3(-Math.cos(pm) * s.r, s.cy, Math.sin(pm) * s.r), mat, base: 0.15 });
  }
  const ring = (rad: number, y: number) => Array.from({ length: 48 }, (_, i) => v3(Math.cos((i / 48) * TAU) * rad, y, Math.sin((i / 48) * TAU) * rad));
  curveTube(G, ring(a.radius, 0.02), neon.low(), 0.06, true);
  curveTube(G, ring(s.r - 0.03, s.cy), neon.top(), 0.06, true);
  // Meridians over the top, floor to floor.
  const vert = neon.vert(), a0 = -Math.asin(s.cy / s.r);
  for (let k = 0; k < 4; k++) {
    const phi = (k * Math.PI) / 4, dx = Math.cos(phi), dz = Math.sin(phi);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const al = a0 + (i / 40) * (Math.PI - 2 * a0), rr = Math.cos(al) * (s.r - 0.03);
      pts.push(v3(dx * rr, s.cy + Math.sin(al) * (s.r - 0.03), dz * rr));
    }
    curveTube(G, pts, vert, 0.04);
  }
}

/** Box with rounded edges: a subdivided box with each vertex pushed onto the rounding. */
function roundBoxGeometry(s: { hx: number; hy: number; hz: number; r: number }, step = 0.7) {
  const g = new THREE.BoxGeometry(2 * s.hx, 2 * s.hy, 2 * s.hz, Math.ceil((2 * s.hx) / step), Math.ceil((2 * s.hy) / step), Math.ceil((2 * s.hz) / step));
  const p = g.attributes.position, n = g.attributes.normal;
  const cx = s.hx - s.r, cy = s.hy - s.r, cz = s.hz - s.r;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const kx = clamp(x, -cx, cx), ky = clamp(y, -cy, cy), kz = clamp(z, -cz, cz);
    let dx = x - kx, dy = y - ky, dz = z - kz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    p.setXYZ(i, kx + dx * s.r, ky + dy * s.r + s.hy, kz + dz * s.r);
    n.setXYZ(i, dx, dy, dz);
  }
  return g;
}

/** Rounded box: floor turf runs up the curves, the rest is glass. */
function buildRoundBox(G: THREE.Group, a: Arena, s: { hx: number; hy: number; hz: number; r: number }, floorMat: THREE.MeshStandardMaterial) {
  const g = roundBoxGeometry(s);
  // Floor face (BoxGeometry group 3, -y): UVs from x/z so the painted floor lines up.
  const uv = g.attributes.uv, p = g.attributes.position, idx = g.index!;
  const fg = g.groups[3];
  for (let i = fg.start; i < fg.start + fg.count; i++) {
    const v = idx.getX(i);
    uv.setXY(v, (p.getX(v) + a.hx) / (2 * a.hx), (a.hz - p.getZ(v)) / (2 * a.hz));
  }
  floorMat.side = THREE.BackSide;
  const H = 2 * s.hy;
  const mats = [glassMat((2 * s.hz) / 3, H / 3), glassMat((2 * s.hz) / 3, H / 3), glassMat((2 * s.hx) / 3, (2 * s.hz) / 3), floorMat, glassMat((2 * s.hx) / 3, H / 3), glassMat((2 * s.hx) / 3, H / 3)];
  G.add(new THREE.Mesh(g, mats));
  const gm = (i: number) => mats[i] as THREE.MeshBasicMaterial;
  glass.push(
    { n: v3(-1, 0, 0), c: v3(s.hx, s.hy, 0), mat: gm(0), base: 0.17 },
    { n: v3(1, 0, 0), c: v3(-s.hx, s.hy, 0), mat: gm(1), base: 0.17 },
    { n: v3(0, -1, 0), c: v3(0, H, 0), mat: gm(2), base: 0.1 },
    { n: v3(0, 0, -1), c: v3(0, s.hy, s.hz), mat: gm(4), base: 0.17 },
    { n: v3(0, 0, 1), c: v3(0, s.hy, -s.hz), mat: gm(5), base: 0.17 },
  );
  const fx = s.hx - s.r, fz = s.hz - s.r;
  const rect: [number, number][] = [[-fx, -fz], [fx, -fz], [fx, fz], [-fx, fz]];
  const low = neon.low(), top = neon.top(), vert = neon.vert();
  loop(G, rect, 0.02, low, 0.06);          // where the floor starts to curve up
  loop(G, a.verts, s.r, low, 0.06);        // where the curve meets the wall
  loop(G, a.verts, H - s.r, top, 0.06);    // top of the wall
  loop(G, rect, H - 0.02, top, 0.06);      // where the ceiling flattens out
  const seg = a.verts.length / 4;
  for (let c = 0; c < 4; c++) {
    const [x, z] = a.verts[Math.round(c * seg + (seg - 1) / 2)];
    tube(G, x, s.r, z, x, H - s.r, z, vert, 0.07);
  }
  // Ribs across the curves (floor-to-wall and wall-to-ceiling), so the halfpipe shape reads.
  const rib = (px: number, pz: number, nx: number, nz: number, top: boolean) => {
    const cy = top ? H - s.r : s.r, pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * (Math.PI / 2), out = Math.sin(t) * (s.r - 0.03), up = Math.cos(t) * (s.r - 0.03) * (top ? 1 : -1);
      pts.push(v3(px + nx * out, cy + up, pz + nz * out));
    }
    curveTube(G, pts, vert, 0.035);
  };
  for (const top of [false, true]) {
    for (let x = -fx; x <= fx + 1e-6; x += (2 * fx) / 4) { rib(x, fz, 0, 1, top); rib(x, -fz, 0, -1, top); }
    for (let z = -fz; z <= fz + 1e-6; z += (2 * fz) / 2) { rib(fx, z, 1, 0, top); rib(-fx, z, -1, 0, top); }
  }
}

/** Solid obstacles inside the arena: glass with neon rims. */
function buildBlocks(G: THREE.Group, a: Arena) {
  if (!a.blocks.length) return;
  const H = a.top;
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.5, 0.3, 1), transparent: true, opacity: 0.09,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const low = neon.low(), top = neon.vert();
  for (const b of a.blocks) {
    if (b.kind === "rect") {
      const w = b.x1 - b.x0, d = b.z1 - b.z0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), mat);
      m.position.set((b.x0 + b.x1) / 2, H / 2, (b.z0 + b.z1) / 2);
      G.add(m);
      const c: [number, number][] = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
      loop(G, c, 0.03, low, 0.05);
      loop(G, c, H, top, 0.06);
    } else {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, H, 40, 1, true), mat);
      m.position.set(b.x, H / 2, b.z);
      G.add(m);
      const ring = (y: number) => Array.from({ length: 32 }, (_, i) => v3(b.x + Math.cos((i / 32) * TAU) * b.r, y, b.z + Math.sin((i / 32) * TAU) * b.r));
      curveTube(G, ring(0.03), low, 0.05, true);
      curveTube(G, ring(H), top, 0.06, true);
      for (let k = 0; k < 4; k++) {
        const an = (k / 4) * TAU + Math.PI / 4, x = b.x + Math.cos(an) * b.r, z = b.z + Math.sin(an) * b.r;
        tube(G, x, 0, z, x, H, z, top, 0.05);
      }
    }
  }
}

/** Stadium floodlights, placed around whatever arena is up. */
function buildRigs(G: THREE.Group, a: Arena) {
  const so = standOutline(a), ex = so.hx, ez = so.hz;
  const mat = new THREE.MeshStandardMaterial({ color: 0x15131f, roughness: 0.7, metalness: 0.4 });
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.5, 2.3) });
  const h = Math.max(HY, a.top) + 9;
  for (const [x, z] of [[-(ex + 13), -(ez + 12)], [ex + 13, -(ez + 12)], [-(ex + 17), ez + 2], [ex + 17, ez + 2]]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.6, h, 0.6), mat);
    pole.position.set(x, h / 2, z);
    G.add(pole);
    const head = new THREE.Group();
    head.position.set(x, h, z);
    G.add(head);
    head.lookAt(0, 2, 0);
    head.add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.9, 0.4), mat));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.62), lamp);
      p.position.set(-1.15 + i * 1.15, -0.4 + j * 0.8, 0.21);
      head.add(p);
    }
  }
}

/** Builds (or swaps to) an arena's floor, glass, neon edges and crowd stands. */
export function setArena(index: number) {
  const idx = ARENAS[index] ? index : 0;
  if (idx === arenaIdx) return;
  if (arenaGroup) { scene.remove(arenaGroup); disposeGroup(arenaGroup); }
  arenaIdx = idx;
  const a = arenaOf(idx);
  const G = new THREE.Group();
  arenaGroup = G;
  scene.add(G);

  // Floor, then glass faded on the side facing the camera.
  const { map, em } = makeFloor(a);
  const floorMat = new THREE.MeshStandardMaterial({
    map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.38, metalness: 0.3,
  });
  glass = [];
  if (a.shell?.kind === "roundbox") buildRoundBox(G, a, a.shell, floorMat);
  else {
    const floor = new THREE.Mesh(arenaShapeGeometry(a, true), floorMat);
    floor.rotation.x = -Math.PI / 2;
    G.add(floor);
    if (a.shell?.kind === "sphere") buildSphere(G, a, a.shell);
    else buildWalls(G, a);
  }
  buildBlocks(G, a);
  buildRigs(G, a);

  // Crowd stands: five tiers behind every wall that doesn't face the camera (spiky arenas get a ring).
  const so = standOutline(a);
  crowd.spots = [];
  const u = 1.7;
  const tiers: { cx: number; cz: number; len: number; rot: number; h: number }[] = [];
  for (let l = 0; l < 5; l++) {
    const c = 3.6 + l * 1.7, h = 0.7 + l * 1.15;
    const ov = insetVerts(so, -c);
    so.walls.forEach((w, i) => {
      if (w.nz > 0.35) return;
      const [x0, z0] = ov[i], [x1, z1] = ov[(i + 1) % ov.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      tiers.push({ cx: (x0 + x1) / 2 + (w.nx * u) / 2, cz: (z0 + z1) / 2 + (w.nz * u) / 2, len: len + u, rot: Math.atan2(x1 - x0, z1 - z0), h });
      for (let s = 0.46; s < len; s += 0.92) {
        const f = s / len;
        crowd.spots.push({
          p: v3(x0 + (x1 - x0) * f + rand(-0.2, 0.2) + w.nx * u * 0.5, h, z0 + (z1 - z0) * f + rand(-0.2, 0.2) + w.nz * u * 0.5),
          ph: rand(0, TAU), f: Math.random(), k: rand(0.6, 1.6), sc: rand(0.88, 1.12), li: -1,
        });
      }
    });
  }
  const stands = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x100e1a, roughness: 0.95 }), Math.max(1, tiers.length));
  tiers.forEach((t, i) => {
    dummy.position.set(t.cx, t.h / 2, t.cz);
    dummy.rotation.set(0, t.rot, 0);
    dummy.scale.set(u, t.h, t.len);
    dummy.updateMatrix();
    stands.setMatrixAt(i, dummy.matrix);
  });
  stands.count = tiers.length;
  G.add(stands);
  const fans = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.42, 2, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), Math.max(1, crowd.spots.length));
  const nLights = Math.ceil(crowd.spots.length * 0.2) + 8;
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), nLights);
  let li = 0;
  const col = new THREE.Color();
  crowd.spots.forEach((s, i) => {
    col.setHSL(rand(0.68, 0.78), rand(0.08, 0.25), rand(0.12, 0.24));
    if (Math.random() < 0.12) col.set(pick(SLOTS).color).multiplyScalar(0.35);
    fans.setColorAt(i, col);
    if (li < nLights && Math.random() < 0.18) {
      s.li = li;
      lights.setColorAt(li, new THREE.Color(pick(SLOTS).color).multiplyScalar(2.2));
      li++;
    }
  });
  fans.count = crowd.spots.length;
  lights.count = li;
  G.add(fans, lights);
  crowd.fans = fans;
  crowd.lights = lights;
}

setArena(0);
document.fonts?.ready.then(() => {
  Promise.all([
    document.fonts.load('900 120px "Big Shoulders Display"'),
    document.fonts.load('700 40px "Chakra Petch"'),
  ]).finally(() => { fontsReady = true; floorPaint?.(); });
});

export function updateCrowd(dt: number, rt: number) {
  crowd.excite = Math.max(0, crowd.excite - dt * 0.45);
  const fans = crowd.fans, lights = crowd.lights;
  if (!fans || !lights) return;
  const ex = 0.1 + crowd.excite;
  for (let i = 0; i < crowd.spots.length; i++) {
    const s = crowd.spots[i];
    const hop = Math.max(0, Math.sin(rt * (5 + s.f * 4) + s.ph)) * 0.34 * Math.min(1, ex * s.k);
    dummy.position.set(s.p.x, s.p.y + 0.41 * s.sc + hop, s.p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(s.sc);
    dummy.updateMatrix();
    fans.setMatrixAt(i, dummy.matrix);
    if (s.li >= 0) {
      dummy.position.set(s.p.x + Math.sin(rt * 6 + s.ph) * 0.18 * Math.min(1, ex * 1.5), s.p.y + 1.05 * s.sc + hop, s.p.z);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      lights.setMatrixAt(s.li, dummy.matrix);
    }
  }
  fans.instanceMatrix.needsUpdate = true;
  lights.instanceMatrix.needsUpdate = true;
}

const tmp = v3();
export function updateWalls(dt: number) {
  for (const w of glass) {
    tmp.subVectors(camera.position, w.c);
    const side = tmp.dot(w.n);
    const target = w.base * smooth(clamp((side + 1) / 3, 0, 1));
    const mat = w.mat;
    mat.opacity = approach(mat.opacity, target, dt * 0.8);
  }
}

export function render() {
  composer.render();
}
