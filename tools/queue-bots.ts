// Matchmaking rules test: bot fill honours every player's toggle, and MATCH_SIZE caps lobbies.
// Usage: bun tools/queue-bots.ts <expectSize> [ws-url]   (run the server with FILL_WAIT=2)
export {};
const SIZE = +(process.argv[2] ?? 4);
const WS_URL = process.argv[3] ?? "ws://localhost:8787/ws";

async function lobby(prefs: number[]): Promise<{ humans: number; bots: number; launchMs: number; bo: number }> {
  const t0 = performance.now();
  let lastBo = -9;
  const socks: WebSocket[] = [];
  const result = new Promise<{ humans: number; bots: number; launchMs: number; bo: number }>((res) => {
    prefs.forEach((p, i) => {
      const ws = new WebSocket(WS_URL);
      socks.push(ws);
      ws.onopen = () => { ws.send(JSON.stringify({ t: "hi", name: `Q${i}`, v: 2 })); ws.send(JSON.stringify({ t: "q", bots: p })); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data as string);
        if (m.t === "qs") lastBo = m.bo;
        if (m.t === "go" && i === 0) {
          const r = m.roster.filter(Boolean);
          res({ humans: r.filter((x: any) => !x.b).length, bots: r.filter((x: any) => x.b).length, launchMs: Math.round(performance.now() - t0), bo: lastBo });
        }
      };
    });
  });
  const r = await result;
  for (const s of socks) { s.send(JSON.stringify({ t: "lv" })); s.close(); }
  await new Promise((x) => setTimeout(x, 400));
  return r;
}

const check = (label: string, ok: boolean, detail: unknown) => console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${JSON.stringify(detail)}`);
if (SIZE === 4) {
  const a = await lobby([1, 1, 1]);
  check("3 humans, all allow bots -> 1 bot fills seat 4", a.humans === 3 && a.bots === 1 && a.bo === 1, a);
  const b = await lobby([1, 0, 1]);
  check("3 humans, one opts out -> humans only", b.humans === 3 && b.bots === 0 && b.bo === 0, b);
  const c = await lobby([1, 1, 1, 1]);
  check("4 humans -> launches immediately, no bots", c.humans === 4 && c.bots === 0 && c.launchMs < 1500, c);
} else {
  const a = await lobby([0, 0, 0]);
  check(`MATCH_SIZE=${SIZE}: 3 humans launch immediately`, a.humans === 3 && a.bots === 0 && a.launchMs < 1500, a);
}
process.exit(0);
