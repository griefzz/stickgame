// Lag-compensation test: a headless "player" that stands still and swings when the
// ball, as the real client would render it, enters its hitbox. Simulates one-way
// latency in both directions. Usage: bun tools/lagtest.ts <oneWayMs> [ws-url]
import { advanceBallFull, type BallKin } from "../src/shared/ball";
import { BALL_R, SWING } from "../src/shared/constants";
import { hitCentre } from "../src/shared/player";

const ONE_WAY = +(process.argv[2] ?? 0) / 1000;
const WS_URL = process.argv[3] ?? "ws://localhost:8799/ws";
const ws = new WebSocket(WS_URL);
const later = (fn: () => void) => (ONE_WAY > 0 ? setTimeout(fn, ONE_WAY * 1000) : fn());
const send = (o: object) => later(() => ws.readyState === 1 && ws.send(JSON.stringify(o)));
let slot = -1, seq = 0, snap: any = null, snapRecv = 0, nextSwing = 0, timer: any;
let hits = 0, kos = 0, swings = 0, threatened = 0;
const now = () => performance.now() / 1000;

ws.onopen = () => { ws.send(JSON.stringify({ t: "hi", name: "LAG" + ONE_WAY * 1000, v: 1 })); send({ t: "pr" }); };
ws.onmessage = (e) => later(() => {
  const m = JSON.parse(e.data as string);
  if (m.t === "go") {
    slot = m.slot;
    timer = setInterval(tick, 1000 / 60);
    setInterval(() => send({ t: "p", c: 0, r: ONE_WAY * 2 }), 1000);
  } else if (m.t === "s") { snap = m; snapRecv = now(); }
  else if (m.t === "e") {
    if (m.k === "hit" && m.s === slot) hits++;
    if (m.k === "ko" && m.v === slot) kos++;
    if (m.k === "launch" && m.tg === slot) threatened++;
    if (m.k === "over") finish();
  } else if (m.t === "end") finish();
});

function tick() {
  if (!snap) return;
  const est = snap.st + (now() - snapRecv) + ONE_WAY;
  const me = snap.p[slot];
  let b = 0;
  if (me && me[12] & 1 && snap.b[0] === 2 && now() >= nextSwing) {
    const k: BallKin = { x: snap.b[1], y: snap.b[2], z: snap.b[3], vx: snap.b[4], vy: snap.b[5], vz: snap.b[6], lob: !!snap.b[11] };
    advanceBallFull(k, Math.min(0.3, est - snap.st));
    const owner = snap.b[7];
    const c = hitCentre({ x: me[0], y: me[1], z: me[2], f: me[6] }, { x: 0, y: 0, z: 0 });
    const d = Math.hypot(k.x - c.x, k.y - c.y, k.z - c.z);
    if (owner !== slot && d <= SWING.hitR + BALL_R - 0.1) { b = 4; swings++; nextSwing = now() + 0.45; }
  }
  send({ t: "i", d: [++seq, 0, 0, 0, b, Math.round(est * 1000) / 1000] });
}

let done = false;
function finish() {
  if (done) return;
  done = true;
  clearInterval(timer);
  console.log(`one-way ${ONE_WAY * 1000}ms: swings=${swings} hits=${hits} kos=${kos} (hit rate on swings ${(swings ? (100 * hits) / swings : 0).toFixed(0)}%)`);
  process.exit(0);
}
setTimeout(finish, 75000);
