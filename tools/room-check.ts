// Private room flow test against a running server.
// Usage: bun tools/room-check.ts [ws-url]
export {};
const WS_URL = process.argv[2] ?? "ws://localhost:8787/ws";
const HEALTH = WS_URL.replace(/^ws/, "http").replace(/\/ws$/, "/health");
let fails = 0;
const check = (label: string, ok: boolean, detail: unknown = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== "" ? "  " + JSON.stringify(detail) : ""}`); if (!ok) fails++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class P {
  ws: WebSocket; name: string; msgs: any[] = []; room: any = null; go: any = null; seq = 0; timer: any = null;
  constructor(name: string) { this.name = name; this.ws = new WebSocket(WS_URL); }
  async open() {
    await new Promise((r) => (this.ws.onopen = r));
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string);
      this.msgs.push(m);
      if (m.t === "rm") this.room = m;
      if (m.t === "rx") this.room = null;
      if (m.t === "go") { this.go = m; this.play(); }
      if (m.t === "end") this.stop();
    };
    this.send({ t: "hi", name: this.name, v: 3 });
    return this;
  }
  send(o: object) { this.ws.send(JSON.stringify(o)); }
  play() { this.stop(); this.timer = setInterval(() => { this.seq++; this.send({ t: "i", d: [this.seq, Math.sin(this.seq / 30) * 0.5, 0, 0, 0, 0, 0] }); }, 1000 / 60); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  last(t: string) { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i]; return null; }
  clear() { this.msgs = []; }
}

const A = await new P("ALICE").open(), B = await new P("BOB").open(), C = await new P("CARL").open(), D = await new P("DANA").open();
A.send({ t: "rc" }); await sleep(300);
const code = A.room?.code;
check("create: room with a 4-letter code, creator is host", /^[A-Z]{4}$/.test(code ?? "") && A.room.host === 1, A.room);
C.send({ t: "rj", code: code === "ZZZZ" ? "YYYY" : "ZZZZ" }); await sleep(250);
check("join: wrong code is refused", C.last("rerr")?.m?.startsWith("No room"), C.last("rerr"));
B.send({ t: "rj", code: code.toLowerCase() }); await sleep(300);
check("join: both see two players, BOB is not host", A.room.players.length === 2 && B.room.players.length === 2 && B.room.host === 0, B.room.players);
B.send({ t: "rs" }); await sleep(300);
check("start: only the host can start", !A.go && !B.go);
B.send({ t: "q" }); await sleep(300);
check("queue: room members can't use the public queue", !B.last("qs"));
A.send({ t: "rs" }); await sleep(400);
check("start: both get the match, tagged with the room", A.go?.rm === code && B.go?.rm === code && A.room.live === 1, { a: A.go?.rm, b: B.go?.rm });
D.send({ t: "rj", code }); await sleep(300);
check("join mid-match: waits in the room", D.room?.live === 1 && !D.go && D.room.players.length === 3, D.room?.players);
A.send({ t: "lv" }); await sleep(400);
check("leave match: back in the room", A.room?.code === code && A.last("end"), A.room?.players?.map((p: any) => p.n + (p.p ? "*" : "")));
await sleep(2500); // BOB alone in the match -> game over -> everyone back to the room
check("match over: everyone back in the room, not live", B.last("e") && B.room?.live === 0 && A.room?.live === 0 && D.room?.live === 0, { live: B.room?.live });
A.go = B.go = D.go = null;
A.send({ t: "rs" }); await sleep(400);
check("rematch: all three in the next match", !!A.go && !!B.go && !!D.go && A.go.roster.filter(Boolean).length === 3);
A.send({ t: "rl" }); await sleep(400);
const newHost = [B, D].find((p) => p.room?.host === 1);
check("host leaves: someone else becomes host", !!newHost && A.room === null, newHost?.name);
B.send({ t: "rl" }); D.send({ t: "rl" }); await sleep(400);
const h = await (await fetch(HEALTH)).json();
check("empty room closes", h.rooms === 0, h);
check("health reports a version", typeof h.version === "string" && h.version.length > 0, h.version);
for (const p of [A, B, C, D]) { p.stop(); p.ws.close(); }
process.exit(fails ? 1 : 0);
