// Headless bot matches on every arena, on a fake clock: bots should still rally (hits and
// K.O.s happen), freestyle when they have spare time, and never end up outside the arena.
// Usage: bun tools/bot-sim.ts [seconds per arena, default 90]
import { Match } from "../src/server/match";
import { Bot } from "../src/server/bot";
import { ARENAS, inside, shellDist } from "../src/shared/arena";
import { PLAYER } from "../src/shared/constants";

const SECS = Number(process.argv[2] ?? 90);
let tricks = 0;
const start = Bot.prototype.startTrick;
Bot.prototype.startTrick = function (...a: Parameters<typeof start>) { tricks++; return start.apply(this, a); };

let failed = 0;
for (let ai = 0; ai < ARENAS.length; ai++) {
  const a = ARENAS[ai];
  tricks = 0;
  const entrants = [0, 1, 2, 3].map((i) => ({ conn: null, name: `Bot ${i}`, bot: true, w: i % 4 }));
  const m = new Match(entrants as never, true, () => {}, null, ai);
  let hits = 0, kos = 0, out = 0, peak = 0, dashes = 0;
  const ev = m.event.bind(m);
  m.event = (e: Parameters<typeof ev>[0]) => {
    const k = (e as { k: string }).k;
    if (k === "hit") hits++;
    if (k === "ko") kos++;
    return ev(e);
  };
  const t0 = m.t;
  for (let i = 1; i <= SECS * 60 && !m.ended; i++) {
    m.tick(t0 + i / 60);
    for (const s of m.slots) {
      if (!s || !s.alive) continue;
      const p = s.p;
      peak = Math.max(peak, p.y);
      if (p.ds === PLAYER.dashTicks - 1) dashes++;
      const ok = a.shell ? shellDist(a.shell, p.x, p.y + PLAYER.wallMargin, p.z) + PLAYER.wallMargin <= 0.02 : inside(a, p.x, p.z, PLAYER.wallMargin - 0.02);
      if (!ok) out++;
    }
  }
  const good = hits >= 3 && tricks >= 4 && out === 0;
  if (!good) failed++;
  console.log(`${good ? "PASS" : "FAIL"}  ${a.key.padEnd(9)} hits ${String(hits).padStart(3)}  K.O.s ${String(kos).padStart(2)}  tricks ${String(tricks).padStart(3)}  dashes ${String(dashes).padStart(4)}  peak ${peak.toFixed(1)} m  out-of-bounds ticks ${out}${m.ended ? "  (match over)" : ""}`);
}
process.exit(failed ? 1 : 0);
