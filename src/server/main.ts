// Overclock Arena game server: WebSocket matchmaking + authoritative 60 Hz matches.
// Also serves the single-file client at "/" so it can run without nginx in dev.
import { join } from "node:path";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { ServerWebSocket } from "bun";
import { DT, MAX_PLAYERS } from "../shared/constants";
import { PROTOCOL, cleanName } from "../shared/protocol";
import { Match, type Conn } from "./match";

const env = (k: string, d: string) => process.env[k] ?? d;
const PORT = +env("PORT", "8787");
const HOST = env("HOST", "0.0.0.0");
const clampInt = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
// Seats in a queue match (humans + bots). A lobby launches at once when this many humans queue.
const MATCH_SIZE = clampInt(+env("MATCH_SIZE", "4"), 2, MAX_PLAYERS, MAX_PLAYERS);
const MIN_PLAYERS = clampInt(+env("MIN_PLAYERS", "2"), 2, MATCH_SIZE, 2);
const FILL_WAIT = +env("FILL_WAIT", "12");          // seconds to wait for a full lobby once MIN is met
// When the wait runs out, bots top the match up to this many seats, but only if every
// player in that lobby has "Fill empty seats with bots" switched on. 0 = never.
const BOT_FILL_TO = (() => { const v = clampInt(+env("BOT_FILL_TO", String(MATCH_SIZE)), 0, MATCH_SIZE, MATCH_SIZE); return v < 2 ? 0 : v; })();
const MAX_CONNS = +env("MAX_CONNS", "400");
const INDEX = env("INDEX_HTML", join(import.meta.dir, "index.html"));

interface Data { conn: Conn }
const conns = new Set<Conn>();
const queue: Conn[] = [];
const matches = new Set<Match>();
let nextId = 1;
let fillDeadline = 0;

const now = () => performance.now() / 1000;
const BOT_NAMES = ["CIRCUIT", "RIVET", "STATIC", "PIXEL", "TURBO", "GLITCH", "SPARK", "VECTOR", "BOLT", "ECHO", "NEON", "ROTOR"];

function randomBots(n: number, taken: string[]): string[] {
  const pool = BOT_NAMES.filter((b) => !taken.includes(b)).sort(() => Math.random() - 0.5);
  return pool.slice(0, n).map((b) => b + " (BOT)");
}

function startMatch(list: Conn[], practice: boolean) {
  const players = [...new Set(list)].filter((c) => conns.has(c) && !c.match);
  if (!players.length) return;
  for (const c of players) {
    const i = queue.indexOf(c);
    if (i >= 0) queue.splice(i, 1);
  }
  const entrants: { conn: Conn | null; name: string; bot: boolean }[] = players.map((c) => ({ conn: c, name: c.name, bot: false }));
  const nBots = practice ? MAX_PLAYERS - entrants.length : botsFor(players);
  for (const n of randomBots(nBots, players.map((p) => p.name))) entrants.push({ conn: null, name: n, bot: true });
  const m = new Match(entrants, practice, (done) => matches.delete(done));
  matches.add(m);
  log(`match ${m.id} start: ${entrants.map((e) => e.name).join(", ")}${practice ? " [practice]" : ""}`);
}

/** -1: server has bot filling off, 0: someone in the lobby turned bots off, 1: everyone allows bots. */
function botPolicy(lobby: Conn[]): number {
  if (!BOT_FILL_TO) return -1;
  return lobby.every((c) => c.bots) ? 1 : 0;
}

/** How many bots a queue match with these humans gets. */
function botsFor(lobby: Conn[]): number {
  return botPolicy(lobby) === 1 ? Math.max(0, BOT_FILL_TO - lobby.length) : 0;
}

function matchmake() {
  for (let i = queue.length - 1; i >= 0; i--) if (!conns.has(queue[i]) || queue[i].state !== "queue") queue.splice(i, 1);
  const t = now();
  if (queue.length >= MATCH_SIZE) {
    startMatch(queue.slice(0, MATCH_SIZE), false);
    fillDeadline = 0;
  } else if (queue.length >= MIN_PLAYERS) {
    if (!fillDeadline) fillDeadline = t + FILL_WAIT;
    if (t >= fillDeadline) { startMatch(queue.slice(), false); fillDeadline = 0; }
  } else fillDeadline = 0;

  const sIn = fillDeadline ? Math.max(0, Math.ceil(fillDeadline - t)) : -1;
  const msg = JSON.stringify({
    t: "qs", n: queue.length, min: MIN_PLAYERS, max: MATCH_SIZE, sIn, names: queue.map((c) => c.name),
    bf: botsFor(queue), bo: botPolicy(queue),
  });
  for (const c of queue) c.send(msg);
}

function stats() {
  const msg = JSON.stringify({ t: "st", on: conns.size, q: queue.length, m: matches.size, b: clientBuild() });
  for (const c of conns) if (c.state !== "match") c.send(msg);
}

function log(s: string) { console.log(`[${new Date().toISOString()}] ${s}`); }

function onMessage(c: Conn, raw: string | Buffer) {
  if (typeof raw !== "string" || raw.length > 512) return;
  let m: any;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.t !== "string") return;
  if (m.t === "i") {
    if (c.match) c.match.handleInput(c, m.d);
    return;
  }
  // Everything else (pings, menu actions) is rate limited: ~8/s, bursts of 16.
  const t = now();
  c.ctl = Math.min(16, c.ctl + (t - c.ctlT) * 8);
  c.ctlT = t;
  if (c.ctl < 1) return;
  c.ctl -= 1;
  switch (m.t) {
    case "p":
      if (Number.isFinite(+m.r)) c.rtt = Math.max(0, Math.min(1, +m.r));
      c.send(JSON.stringify({ t: "po", c: m.c, s: Math.round(now() * 1e4) / 1e4 }));
      return;
    case "hi":
    case "name": {
      const n = cleanName(m.name);
      c.name = n || c.name;
      if (m.t === "hi") c.send(JSON.stringify({ t: "w", id: c.id, v: PROTOCOL, size: MATCH_SIZE, bf: BOT_FILL_TO, b: clientBuild() }));
      return;
    }
    case "bots":
      // Opt-in must be explicit; a missing or odd value means "humans only".
      c.bots = m.on === 1 || m.on === true;
      if (c.state === "queue") matchmake();
      return;
    case "q":
      if (c.state === "menu" && !c.match) {
        if ("bots" in m) c.bots = m.bots === 1 || m.bots === true;
        unqueue(c);
        c.state = "queue";
        queue.push(c);
        matchmake();
      }
      return;
    case "x":
      if (c.state === "queue") {
        c.state = "menu";
        unqueue(c);
        matchmake();
      }
      return;
    case "pr":
      if (c.state === "queue") { unqueue(c); c.state = "menu"; }
      if (c.state === "menu" && !c.match) startMatch([c], true);
      return;
    case "lv":
      unqueue(c);
      if (c.match) c.match.removeConn(c);
      c.match = null;
      c.state = "menu";
      c.send('{"t":"end"}');
      return;
  }
}

function unqueue(c: Conn) {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i] === c) queue.splice(i, 1);
}

function sendStats(c: Conn) {
  c.send(JSON.stringify({ t: "st", on: conns.size, q: queue.length, m: matches.size, b: clientBuild() }));
}

const server = Bun.serve<Data>({
  port: PORT,
  hostname: HOST,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (conns.size >= MAX_CONNS) return new Response("server full", { status: 503 });
      const conn: Conn = {
        id: nextId++, name: `PLAYER-${Math.floor(1000 + Math.random() * 9000)}`, rtt: 0.08,
        send: () => {}, match: null, slot: -1, state: "menu", ctl: 16, ctlT: now(), bots: false,
      };
      if (srv.upgrade(req, { data: { conn } })) return;
      return new Response("websocket upgrade failed", { status: 400 });
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true, online: conns.size, queue: queue.length, matches: matches.size });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (!existsSync(INDEX)) return new Response("client not built: run `bun run build`", { status: 500 });
      return new Response(Bun.file(INDEX), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    maxPayloadLength: 1024,
    idleTimeout: 60,
    perMessageDeflate: false,
    open(ws: ServerWebSocket<Data>) {
      const c = ws.data.conn;
      c.send = (s: string) => { if (ws.readyState === 1) ws.send(s); };
      conns.add(c);
      sendStats(c);
    },
    message(ws: ServerWebSocket<Data>, msg) {
      onMessage(ws.data.conn, msg as string);
    },
    close(ws: ServerWebSocket<Data>) {
      const c = ws.data.conn;
      conns.delete(c);
      unqueue(c);
      if (c.match) c.match.removeConn(c);
      c.send = () => {};
    },
  },
});

// Fixed-step game loop shared by every match.
let nextTick = now();
setInterval(() => {
  const t = now();
  if (t - nextTick > 0.25) nextTick = t; // fell far behind (suspend/debugger): skip ahead
  while (nextTick <= t) {
    for (const m of matches) m.tick(nextTick);
    nextTick += DT;
  }
}, 2);

setInterval(matchmake, 250);
setInterval(stats, 2000);

log(`Overclock server on http://${HOST}:${server.port}  (ws path /ws, match size ${MATCH_SIZE}, min ${MIN_PLAYERS}, fill wait ${FILL_WAIT}s, bot fill ${BOT_FILL_TO ? "to " + BOT_FILL_TO : "off"})`);

// Build ID of the client page currently on disk (re-read when the file or the
// dist symlink changes), so idle players can reload into a fresh deploy.
let buildCache = { key: "", id: "" };
function clientBuild(): string {
  try {
    const key = realpathSync(INDEX) + ":" + statSync(INDEX).mtimeMs;
    if (key !== buildCache.key) {
      const m = /<meta name="build" content="([^"]+)"/.exec(readFileSync(INDEX, "utf8").slice(0, 4096));
      buildCache = { key, id: m ? m[1] : "" };
    }
    return buildCache.id;
  } catch {
    return "";
  }
}
