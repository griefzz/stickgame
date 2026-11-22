// Load check: N concurrent practice matches (1 idle "human" + 3 bots each) for D seconds.
// Usage: bun tools/soak.ts <matches> <seconds> [ws-url]
export {};
const N = +(process.argv[2] ?? 8), D = +(process.argv[3] ?? 40), WS_URL = process.argv[4] ?? "ws://localhost:8787/ws";
let snaps = 0, overs = 0;
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(WS_URL);
  let seq = 0, timer: any;
  ws.onopen = () => { ws.send(JSON.stringify({ t: "hi", name: "SOAK" + i, v: 1 })); ws.send(JSON.stringify({ t: "pr" })); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data as string);
    if (m.t === "go") timer = setInterval(() => ws.send(JSON.stringify({ t: "i", d: [++seq, Math.sin(seq / 40), Math.cos(seq / 55), 0, seq % 50 === 0 ? 4 : 0, 0] })), 1000 / 60);
    if (m.t === "s") snaps++;
    if (m.t === "e" && m.k === "over") overs++;
    if (m.t === "end") { clearInterval(timer); ws.send(JSON.stringify({ t: "pr" })); }
  };
}
setTimeout(() => { console.log(`${N} matches x ${D}s: snapshots/s per client = ${(snaps / D / N).toFixed(1)}, sets finished = ${overs}`); process.exit(0); }, D * 1000);
