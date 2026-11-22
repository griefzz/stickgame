// Connects to a game server (directly or through nginx) and waits for the welcome message.
// Usage: bun tools/ws-check.ts [ws-url]
export {};
const url = process.argv[2] ?? "ws://localhost:8787/ws";
const ws = new WebSocket(url);
ws.onopen = () => ws.send(JSON.stringify({ t: "hi", name: "CHECK", v: 2 }));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data as string);
  if (m.t === "w") {
    console.log(`PASS  websocket ${url}: welcome, build ${m.b || "?"}, match size ${m.size}`);
    process.exit(0);
  }
};
ws.onerror = () => { console.log(`FAIL  websocket ${url}: connection error`); process.exit(1); };
setTimeout(() => { console.log(`FAIL  websocket ${url}: no welcome within 5 s`); process.exit(1); }, 5000);
