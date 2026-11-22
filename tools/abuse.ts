// Regression: queue/leave spam must not let one connection fill several slots or leak matches.
export {};
const WS_URL = process.argv[2] ?? "ws://localhost:8787/ws";
const HEALTH = WS_URL.replace(/^ws/, "http").replace(/\/ws$/, "/health");
const ws = new WebSocket(WS_URL);
let gos = 0;
ws.onmessage = (e) => { const m = JSON.parse(e.data as string); if (m.t === "go") gos++; };
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ t: "hi", name: "ABUSE", v: 1 }));
for (const t of ["q", "lv", "q", "lv", "q", "lv", "q"]) ws.send(JSON.stringify({ t }));
for (let i = 0; i < 200; i++) ws.send(JSON.stringify({ t: "name", name: "SPAM" + i }));
await new Promise((r) => setTimeout(r, 3500));
const mid = await (await fetch(HEALTH)).json();
ws.close();
await new Promise((r) => setTimeout(r, 2000));
const after = await (await fetch(HEALTH)).json();
console.log(`matches started for one conn: ${gos} | while connected: ${JSON.stringify(mid)} | after close: ${JSON.stringify(after)}`);
console.log(gos === 0 && after.matches === 0 && after.queue === 0 ? "PASS" : "FAIL");
process.exit(0);
