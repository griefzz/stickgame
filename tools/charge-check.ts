// Charge + weapon test: plays a practice match as the Slab paddle, holds swing through
// its own freeze, and checks the shot comes out charged and faster.
// Usage: bun tools/charge-check.ts [ws-url]
import { advanceBallFull, newKin, type BallKin } from "../src/shared/ball";
import { BALL_R, SWING, WEAPONS } from "../src/shared/constants";
import { hitCentre } from "../src/shared/player";

const WS_URL = process.argv[2] ?? "ws://localhost:8787/ws";
const ws = new WebSocket(WS_URL);
let slot = -1, seq = 0, snap: any = null, snapRecv = 0, nextSwing = 0, holdUntil = 0, timer: any;
let rosterW = -1, charged = 0, chargedFaster = 0, hits = 0, lastHitSpd = 0;
const now = () => performance.now() / 1000;
let fails = 0;
const check = (l: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}  ${d}`); if (!ok) fails++; };

ws.onopen = () => { ws.send(JSON.stringify({ t: "hi", name: "CHARGER", v: 4, w: 3 })); ws.send(JSON.stringify({ t: "pr" })); };
ws.onmessage = (e) => {
  const m = JSON.parse(e.data as string);
  if (m.t === "go") { slot = m.slot; rosterW = m.roster[slot].w; timer = setInterval(tick, 1000 / 60); }
  else if (m.t === "s") { snap = m; snapRecv = now(); }
  else if (m.t === "e" && m.k === "hit" && m.s === slot && !m.bu) { hits++; lastHitSpd = m.spd; holdUntil = now() + 0.7; }
  else if (m.t === "e" && m.k === "rel" && m.s === slot && !m.bu && m.ch > 0) { charged++; if (m.spd > lastHitSpd * 1.05) chargedFaster++; if (charged >= 3) finish(); }
  else if (m.t === "end" || (m.t === "e" && m.k === "over")) finish();
};

function tick() {
  if (!snap) return;
  const me = snap.p[slot];
  let b = now() < holdUntil ? 32 : 0; // keep holding swing through our own freeze
  if (me && me[12] & 1 && snap.b[0] === 2 && now() >= nextSwing) {
    const k: BallKin = { ...newKin(), x: snap.b[1], y: snap.b[2], z: snap.b[3], vx: snap.b[4], vy: snap.b[5], vz: snap.b[6], lob: !!snap.b[11], cv: snap.b[13] ?? 0, ct: snap.b[14] ?? 0 };
    advanceBallFull(k, Math.min(0.3, now() - snapRecv));
    const c = hitCentre({ x: me[0], y: me[1], z: me[2], f: me[6] }, { x: 0, y: 0, z: 0 });
    if (snap.b[7] !== slot && Math.hypot(k.x - c.x, k.y - c.y, k.z - c.z) <= SWING.hitR + BALL_R - 0.1) { b |= 4 | 32; nextSwing = now() + 0.45; }
  }
  ws.send(JSON.stringify({ t: "i", d: [++seq, 0, 0, 0, b, Math.round((snap.st + now() - snapRecv) * 1000) / 1000, 0] }));
}

let done = false;
function finish() {
  if (done) return;
  done = true;
  clearInterval(timer);
  check("weapon choice reaches the roster", rosterW === 3, `w=${rosterW} (${WEAPONS[rosterW]?.name})`);
  check("holding swing charges the shot", charged > 0, `${charged} charged of ${hits} hits`);
  check("charged shots fire faster than the hit", chargedFaster === charged && charged > 0, `${chargedFaster}/${charged}`);
  process.exit(fails ? 1 : 0);
}
setTimeout(finish, 90000);
