// Keeps one practice match running (moving, so it isn't kicked as AFK) for N seconds.
// Used by CI to check that server updates wait for live matches.
// Usage: bun tools/hold-match.ts [ws-url] [seconds]
export {};
const url = process.argv[2] ?? "ws://localhost:8787/ws";
const secs = +(process.argv[3] ?? 60);
const ws = new WebSocket(url);
let seq = 0;
ws.onopen = () => {
  ws.send(JSON.stringify({ t: "hi", name: "HOLDER", v: 2 }));
  ws.send(JSON.stringify({ t: "pr" }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data as string);
  if (m.t === "go") {
    console.log("holding a practice match");
    setInterval(() => { seq++; ws.send(JSON.stringify({ t: "i", d: [seq, Math.sin(seq / 30) * 0.6, 0, 0, 0, 0] })); }, 1000 / 60);
  }
};
setTimeout(() => process.exit(0), secs * 1000);
