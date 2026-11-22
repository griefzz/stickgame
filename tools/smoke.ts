// Headless smoke test: connects fake players, exercises queue + practice, logs events.
export {};
// Usage: bun tools/smoke.ts [ws-url]
const WS_URL = process.argv[2] ?? "ws://localhost:8787/ws";
type Msg = any;

function client(name: string, onMsg: (m: Msg, ws: WebSocket) => void): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => { ws.send(JSON.stringify({ t: "hi", name, v: 1 })); res(ws); };
    ws.onerror = (e) => rej(e);
    ws.onmessage = (e) => onMsg(JSON.parse(e.data as string), ws);
  });
}

const t0 = performance.now();
const ts = () => ((performance.now() - t0) / 1000).toFixed(2).padStart(6);
const counts: Record<string, number> = {};
let snaps = 0;

// Test 1: practice match, the human stands still and should be K.O.'d out.
async function practice() {
  return new Promise<void>(async (done) => {
    let seq = 0, slot = -1, timer: any;
    const ws = await client("SMOKE", (m, ws) => {
      if (m.t === "go") {
        slot = m.slot;
        console.log(`${ts()} practice go slot=${slot} roster=${m.roster.map((r: any) => r?.n).join(",")}`);
        timer = setInterval(() => { ++seq; ws.send(JSON.stringify({ t: "i", d: [seq, Math.sin(seq / 30) * 0.5, 0, 0, 0, 0] })); }, 1000 / 60);
      } else if (m.t === "s") snaps++;
      else if (m.t === "e") {
        counts[m.k] = (counts[m.k] ?? 0) + 1;
        if (["ko", "over", "fight", "spawn"].includes(m.k)) console.log(`${ts()} event ${m.k} ${JSON.stringify(m)}`);
      } else if (m.t === "end") { clearInterval(timer); ws.close(); done(); }
    });
    ws.send(JSON.stringify({ t: "pr" }));
  });
}

// Test 2: two humans queue and get matched.
async function queue() {
  return new Promise<void>(async (done) => {
    let got = 0;
    const mk = (n: string) => client(n, (m, ws) => {
      if (m.t === "qs") console.log(`${ts()} ${n} qs n=${m.n} sIn=${m.sIn} names=${m.names}`);
      if (m.t === "go") {
        console.log(`${ts()} ${n} go slot=${m.slot}`);
        if (++got === 2) setTimeout(() => { ws.send(JSON.stringify({ t: "lv" })); }, 500);
      }
      if (m.t === "e" && m.k === "over") console.log(`${ts()} ${n} over ${JSON.stringify(m.rank)}`);
      if (m.t === "end") { console.log(`${ts()} ${n} end`); ws.close(); if (n === "B") done(); }
    });
    const a = await mk("A"); a.send(JSON.stringify({ t: "q" }));
    const b = await mk("B"); b.send(JSON.stringify({ t: "q" }));
  });
}

await queue();
console.log("--- practice ---");
await practice();
console.log(`${ts()} done. snapshots=${snaps} events=${JSON.stringify(counts)}`);
process.exit(0);
